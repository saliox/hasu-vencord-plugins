/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import { Margins } from "@utils/margins";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Forms, SelectedChannelStore, showToast, Toasts } from "@webpack/common";

const VoiceActions = findByPropsLazy("selectVoiceChannel", "selectChannel");

const STORAGE_KEY = "VoiceAutoReconnect_target";
const TICK_MS = 4000;
const GRACE_TICKS = 2;          // ~8 s de coupure avant qu'on rejoigne (laisse Discord tenter d'abord)
const STARTUP_DELAY_MS = 8000;  // laisse la passerelle se connecter au démarrage
const REJOIN_DEBOUNCE_MS = 5000;
const MAX_CONSECUTIVE_FAILURES = 6; // au-delà, on abandonne (banni/expulsé/salon plein…) au lieu de boucler à l'infini

interface Target {
    channelId: string;
    /** horodatage de la dernière fois où on était dans ce salon (pour la fraîcheur au démarrage) */
    at: number;
}

let target: Target | null = null;
let watchdog: number | undefined;
let startupTimer: number | undefined;
let missCount = 0;
let lastRejoinAt = 0;
let rtcState = ""; // état de la connexion vocale RTC (via RTC_CONNECTION_STATE)
let lastRtcDownAt = 0; // horodatage de la dernière coupure RTC vue (voir VOICE_CHANNEL_SELECT)
let consecutiveFailures = 0; // tentatives de rejoin consécutives sans succès confirmé
// tant que false, on ignore les VOICE_CHANNEL_SELECT à channelId:null : au tout début du
// démarrage, Discord peut émettre un événement de synchronisation avec channelId:null avant
// même que lastRtcDownAt ait une valeur utile, ce qui viderait `target` avant que la
// reconnexion au démarrage ait eu sa chance de s'exécuter.
let startupComplete = false;

/** Valide grossièrement la forme d'une valeur chargée depuis DataStore avant de lui faire confiance. */
function isValidTarget(value: unknown): value is Target {
    if (!value || typeof value !== "object") return false;
    const v = value as Record<string, unknown>;
    return typeof v.channelId === "string" && v.channelId.length > 0
        && typeof v.at === "number" && Number.isFinite(v.at);
}

const settings = definePluginSettings({
    reconnectOnDrop: {
        type: OptionType.BOOLEAN,
        description: "Reconnexion automatique après une coupure réseau (en pleine session)",
        default: true
    },
    reconnectOnStartup: {
        type: OptionType.BOOLEAN,
        description: "Rejoindre le dernier salon vocal au démarrage de Discord (après crash/redémarrage)",
        default: true
    },
    startupMaxAge: {
        type: OptionType.SELECT,
        description: "Au démarrage, rejoindre seulement si tu étais en vocal il y a moins de…",
        options: [
            { label: "5 minutes", value: 5 },
            { label: "15 minutes", value: 15, default: true },
            { label: "1 heure", value: 60 },
            { label: "Toujours (peu importe le délai)", value: 0 }
        ]
    },
    notify: {
        type: OptionType.BOOLEAN,
        description: "Afficher une petite notification lors d'une reconnexion",
        default: true
    }
});

function saveTarget() {
    // persistance best-effort : capture toute erreur de stockage pour éviter
    // une promesse rejetée non gérée (et une divergence mémoire/disque silencieuse).
    DataStore.set(STORAGE_KEY, target).catch(e =>
        console.error("[VoiceAutoReconnect] échec de la persistance:", e)
    );
}

function rejoin(reason: string) {
    if (!target) return;
    if (Date.now() - lastRejoinAt < REJOIN_DEBOUNCE_MS) return;
    lastRejoinAt = Date.now();
    try {
        VoiceActions.selectVoiceChannel(target.channelId);
        if (settings.store.notify) {
            showToast(`Reconnexion au salon vocal (${reason})…`, Toasts.Type.MESSAGE);
        }
    } catch {
        // salon supprimé, plus les permissions, etc. : on laisse tomber
    }
}

function giveUp() {
    // trop d'échecs consécutifs (banni, expulsé, salon plein/restreint…) : on arrête de
    // spammer des tentatives (et des toasts) et on efface la cible.
    target = null;
    saveTarget();
    missCount = 0;
    consecutiveFailures = 0;
    if (settings.store.notify) {
        showToast("Reconnexion au vocal abandonnée après plusieurs échecs.", Toasts.Type.FAILURE);
    }
}

function tick() {
    if (!settings.store.reconnectOnDrop || !target) {
        missCount = 0;
        consecutiveFailures = 0;
        return;
    }

    const current = SelectedChannelStore.getVoiceChannelId();

    // suivre un déplacement (admin ou manuel) sans se battre
    if (current && current !== target.channelId) {
        target = { channelId: current, at: Date.now() };
        saveTarget();
        consecutiveFailures = 0;
    }

    // connecté au bon salon ET RTC pas tombé => tout va bien.
    // (rtcState vide au départ = on fait confiance à getVoiceChannelId)
    const rtcDown = rtcState === "RTC_DISCONNECTED" || rtcState === "DISCONNECTED";
    if (current === target.channelId && !rtcDown) {
        missCount = 0;
        consecutiveFailures = 0;
        return;
    }

    // Discord est en train de (re)connecter tout seul : on le laisse faire
    if (rtcState === "RTC_CONNECTING") {
        missCount = 0;
        return;
    }

    // Ici : soit on n'est plus dans le salon (current null / différent), soit le
    // RTC est tombé alors que le salon reste sélectionné = coupure subie.
    // (un départ VOLONTAIRE a mis target à null via VOICE_CHANNEL_SELECT.)
    if (!navigator.onLine) return; // hors-ligne : inutile d'essayer, on attend

    missCount++;
    if (missCount >= GRACE_TICKS) {
        missCount = 0;
        consecutiveFailures++;
        if (consecutiveFailures > MAX_CONSECUTIVE_FAILURES) {
            giveUp();
            return;
        }
        rejoin("coupure réseau");
    }
}

export default definePlugin({
    name: "VoiceAutoReconnect",
    // Bilingue / Bilingual
    description: "Te reconnecte automatiquement à ton salon vocal après une coupure réseau ou un redémarrage de Discord. / Automatically rejoins your voice channel after a network drop or a Discord restart.",
    authors: [{ name: "Saliox", id: 0n }],
    tags: ["Voice", "Utility"],
    settings,

    flux: {
        // l'utilisateur sélectionne un salon vocal (rejoint / se déplace / quitte) = son INTENTION.
        // NB : cet événement n'est censé PAS être émis par une coupure réseau, seulement par une
        // action explicite (bouton, déplacement, déconnexion) — donc target ne s'efface qu'à un
        // départ voulu. Filets de sécurité pour deux cas non testés où channelId:null ne serait
        // PAS un départ volontaire :
        //  1) coupure RTC toute récente (< 3s) — on laisse tick() tenter la reconnexion ;
        //  2) démarrage en cours (avant startupComplete) — Discord peut émettre un événement de
        //     synchronisation à channelId:null pendant que la passerelle se met à jour, avant même
        //     que la reconnexion au démarrage ait eu la chance de s'exécuter ; on ne veut surtout
        //     pas que ça vide `target` juste après l'avoir chargé depuis le stockage.
        VOICE_CHANNEL_SELECT({ channelId }: { channelId: string | null; }) {
            if (channelId === null && !startupComplete) {
                missCount = 0;
                return;
            }
            if (channelId === null && Date.now() - lastRtcDownAt < 3000) {
                missCount = 0;
                return;
            }
            target = channelId ? { channelId, at: Date.now() } : null;
            saveTarget();
            missCount = 0;
            consecutiveFailures = 0;
        },
        // état réel de la connexion vocale ; on ignore les autres contextes (stream…)
        RTC_CONNECTION_STATE({ state, context }: { state: string; context?: string; }) {
            if (context && context !== "default") return;
            rtcState = state;
            if (state === "RTC_DISCONNECTED" || state === "DISCONNECTED") lastRtcDownAt = Date.now();
        }
    },

    async start() {
        missCount = 0;
        consecutiveFailures = 0;
        startupComplete = false;

        const rawSaved = await DataStore.get<unknown>(STORAGE_KEY);
        const saved = isValidTarget(rawSaved) ? rawSaved : null;
        if (rawSaved != null && !saved) {
            console.warn("[VoiceAutoReconnect] valeur stockée invalide, ignorée:", rawSaved);
        }

        if (settings.store.reconnectOnStartup && saved) {
            const maxAge = settings.store.startupMaxAge; // minutes, 0 = toujours
            const ageMin = (Date.now() - saved.at) / 60000;
            if (maxAge === 0 || ageMin <= maxAge) {
                target = saved;
                // rejoindre une fois la passerelle prête, si on n'est pas déjà en vocal
                startupTimer = window.setTimeout(() => {
                    startupTimer = undefined;
                    if (target && !SelectedChannelStore.getVoiceChannelId()) {
                        rejoin("redémarrage");
                    }
                    // la tentative de reconnexion au démarrage a eu sa chance (ou n'était pas
                    // nécessaire) : les événements channelId:null redeviennent dignes de confiance.
                    startupComplete = true;
                }, STARTUP_DELAY_MS);
            } else {
                target = null;
                startupComplete = true;
            }
        } else {
            // pas de reconnexion au démarrage : on repart propre pour cette session
            target = null;
            startupComplete = true;
        }
        saveTarget();

        watchdog = window.setInterval(tick, TICK_MS);
    },

    stop() {
        if (watchdog) window.clearInterval(watchdog);
        if (startupTimer) window.clearTimeout(startupTimer);
        watchdog = undefined;
        startupTimer = undefined;
        startupComplete = false;
    },

    settingsAboutComponent: () => (
        <>
            <Forms.FormTitle>🇫🇷 Objectif</Forms.FormTitle>
            <Forms.FormText className={Margins.bottom8}>
                <b>VoiceAutoReconnect</b> retient le salon vocal dans lequel tu es et t'y reconnecte
                automatiquement dans deux cas :
            </Forms.FormText>
            <Forms.FormText className={Margins.bottom8}>
                • <b>Coupure réseau</b> — si ta connexion saute et que tu es éjecté du vocal, il t'y remet
                dès que le réseau revient (après un court délai, pour laisser Discord tenter sa propre reconnexion).<br />
                • <b>Redémarrage de Discord</b> — après un crash/redémarrage, il rejoint ton dernier salon vocal
                (seulement si c'était récent, réglable).
            </Forms.FormText>
            <Forms.FormText className={Margins.bottom8}>
                ✅ Si tu quittes le vocal <b>volontairement</b> (bouton raccrocher), il ne te fait PAS revenir.
                Et si un admin te déplace, il te suit sans te ramener de force.
            </Forms.FormText>

            <Forms.FormTitle className={Margins.top16}>🇬🇧 Purpose</Forms.FormTitle>
            <Forms.FormText className={Margins.bottom8}>
                <b>VoiceAutoReconnect</b> remembers your current voice channel and rejoins it automatically after a
                <b> network drop</b> (once the network is back) or a <b>Discord restart</b> (if it was recent).
            </Forms.FormText>
            <Forms.FormText>
                ✅ If you leave voice <b>on purpose</b>, it won't bring you back; if an admin moves you, it follows
                instead of forcing you back.
            </Forms.FormText>
        </>
    )
});
