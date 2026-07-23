/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Margins } from "@utils/margins";
import definePlugin, { IconComponent, OptionType } from "@utils/types";
import { findByPropsLazy, findComponentByCodeLazy, findModuleFactory, findStoreLazy } from "@webpack";
import { Forms, SelectedChannelStore, showToast, Toasts } from "@webpack/common";

const VoiceActions = findByPropsLazy("toggleSelfMute", "toggleSelfDeaf");
const AudioActions = findByPropsLazy("setOutputVolume", "setInputVolume");
const MediaEngineStore = findStoreLazy("MediaEngineStore");
// bouton du panneau vocal (à côté du micro / casque / paramètres)
const PanelButton = findComponentByCodeLazy(".GREEN,positionKeyStemOverride:");

// même chaîne que `find` du patch gateway plus bas : un seul endroit à mettre à jour si
// Discord change son code, et ça garantit que la vérification cible EXACTEMENT le même module.
const GATEWAY_MODULE_FIND = '"REQUEST_CHANNEL_INFO"';

let patchCheckTimer: number | undefined;

const settings = definePluginSettings({
    fakeDeaf: {
        type: OptionType.BOOLEAN,
        description: "Apparaître casque coupé (deafen) aux yeux des autres",
        default: true
    },
    fakeMute: {
        type: OptionType.BOOLEAN,
        description: "Apparaître micro coupé aussi (aspect identique à un vrai deafen)",
        default: true
    },
    cutOutput: {
        type: OptionType.BOOLEAN,
        description: "⚠️ Couper AUSSI ton casque en plus de l'apparence (tu n'entendras PLUS les autres). Laisse désactivé pour paraître sourd tout en entendant et parlant normalement.",
        default: false,
        // sans ça, cocher/décocher pendant que le casque fantôme est déjà actif n'a aucun
        // effet tant qu'on ne le désactive/réactive pas manuellement — on ré-applique tout de
        // suite, comme le fait discordOptimizer pour ses propres réglages (onChange: () => apply()).
        onChange: () => applyCutOutput()
    },
    panelButton: {
        type: OptionType.BOOLEAN,
        description: "Afficher le bouton dans le panneau vocal, à côté du micro/casque",
        default: true,
        restartNeeded: true
    },
    chatButton: {
        type: OptionType.BOOLEAN,
        description: "Afficher aussi le bouton dans la barre de message",
        default: false
    },
    active: {
        type: OptionType.BOOLEAN,
        description: "Casque fantôme actif",
        default: false,
        hidden: true
    },
    savedVolume: {
        type: OptionType.NUMBER,
        description: "Volume de sortie sauvegardé",
        default: 100,
        hidden: true
    },
    migrated: {
        type: OptionType.BOOLEAN,
        description: "Migration de l'ancien défaut cutOutput effectuée",
        default: false,
        hidden: true
    },
    volumeCutApplied: {
        type: OptionType.BOOLEAN,
        description: "Volume de sortie actuellement forcé à 0 par le plugin (état interne)",
        default: false,
        hidden: true
    }
});

// renvoie l'état vocal actuel au serveur : chaque toggle émet un
// voiceStateUpdate, que notre patch réécrit à la volée
function resendVoiceState() {
    if (!SelectedChannelStore.getVoiceChannelId()) return;
    VoiceActions.toggleSelfMute();
    VoiceActions.toggleSelfMute();
}

// Réconcilie l'état RÉEL du volume de sortie (`volumeCutApplied`) avec le réglage `cutOutput`
// courant. Appelée à l'activation et à chaque changement du réglage `cutOutput` (onChange),
// pour que cocher/décocher pendant que le casque fantôme est déjà actif ait un effet immédiat
// (comme discordOptimizer le fait pour ses propres réglages).
function applyCutOutput() {
    if (!settings.store.active) return; // rien à réconcilier si le casque fantôme est inactif

    if (settings.store.cutOutput && !settings.store.volumeCutApplied) {
        // capture le volume réel AVANT de forcer à 0, sans condition :
        // si l'utilisateur avait déjà 0, on doit restaurer 0 (pas un défaut 100).
        settings.store.savedVolume = MediaEngineStore.getOutputVolume();
        AudioActions.setOutputVolume(0);
        settings.store.volumeCutApplied = true;
    } else if (!settings.store.cutOutput && settings.store.volumeCutApplied) {
        // On se fie à `volumeCutApplied` (ce qui a été RÉELLEMENT appliqué), pas à la valeur
        // courante de `cutOutput` : si l'utilisateur décoche ce réglage pendant que le casque
        // fantôme est actif, le volume restait coincé à 0 pour de bon (rien ne le restaurait
        // plus jamais, ni ce toggle ni stop()).
        AudioActions.setOutputVolume(settings.store.savedVolume ?? 100);
        settings.store.volumeCutApplied = false;
    }
}

/**
 * Vérifie que le patch gateway (qui réécrit self_mute/self_deaf dans le paquet voiceStateUpdate)
 * a réellement été appliqué, en inspectant le code compilé du module webpack visé (même chaîne
 * `find` que le patch ci-dessous). C'est actuellement la seule façon fiable de détecter un échec
 * silencieux du patch (ex. Discord renomme les variables et le regex ne matche plus) : Vencord
 * n'expose pas d'état succès/échec par patch en dehors des builds de développement.
 * @returns true = patch confirmé présent, false = patch confirmé absent (le plugin ne protège
 *   RIEN), null = indéterminable (module pas encore chargé, ou API indisponible) — dans ce cas
 *   on ne doit ni alarmer ni rassurer l'utilisateur.
 */
function verifyGatewayPatch(): boolean | null {
    try {
        const factory = findModuleFactory(GATEWAY_MODULE_FIND);
        if (!factory) return null;
        const src = String(factory);
        return src.includes(".fakeMute(") && src.includes(".fakeDeaf(");
    } catch {
        return null;
    }
}

let patchWarningShown = false;

/** Revérifie le patch et, s'il est confirmé absent alors que le casque fantôme est censé être
 * actif, prévient clairement l'utilisateur au lieu de le laisser croire qu'il est protégé. */
function checkPatchAndWarn(force = false) {
    const result = verifyGatewayPatch();

    if (result === false && settings.store.active && (force || !patchWarningShown)) {
        patchWarningShown = true;
        console.error(
            "[FakeDeafen] Le patch de la passerelle (self_mute/self_deaf) semble ne PAS avoir été appliqué " +
            "(Discord a probablement changé son code interne). Le casque fantôme n'offre actuellement AUCUNE " +
            "protection réelle : ton vrai état vocal (micro/casque) est envoyé tel quel."
        );
        showToast(
            "⚠️ FakeDeafen : le patch interne semble cassé (mise à jour de Discord ?). Aucune protection réelle n'est active.",
            Toasts.Type.FAILURE
        );
    } else if (result === true) {
        patchWarningShown = false; // se réarme si jamais ça se dégrade plus tard
    }

    return result;
}

function setFakeDeafen(value: boolean) {
    settings.store.active = value;

    if (value) {
        applyCutOutput();
        // vérifie tout de suite que la protection est réellement effective, et prévient
        // clairement si ce n'est pas le cas plutôt que de laisser afficher "actif" à tort.
        checkPatchAndWarn(true);
    } else if (settings.store.volumeCutApplied) {
        // toujours restaurer le volume à la désactivation, même si `applyCutOutput` n'a pas pu
        // tourner entretemps (ex. cutOutput resté coché) — voir son commentaire pour le détail.
        AudioActions.setOutputVolume(settings.store.savedVolume ?? 100);
        settings.store.volumeCutApplied = false;
    }

    resendVoiceState();
    showToast(
        value
            ? "Casque fantôme activé : tu apparais muet mais ton micro émet toujours"
            : "Casque fantôme désactivé : ton vrai état vocal est rétabli",
        Toasts.Type.SUCCESS
    );
}

const FakeDeafenIcon: IconComponent = ({ height = 20, width = 20, className }) => {
    const { active: enabled } = settings.use(["active"]);
    return (
        <svg
            width={width}
            height={height}
            className={className}
            viewBox="0 0 24 24"
            style={{ scale: "1.1", color: enabled ? "var(--status-danger)" : "currentcolor" }}
        >
            <path
                fill="currentColor"
                d="M12 3a9 9 0 0 0-9 9v7a2 2 0 0 0 2 2h3a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H5v-1a7 7 0 1 1 14 0v1h-3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h3a2 2 0 0 0 2-2v-7a9 9 0 0 0-9-9Z"
            />
            {enabled && (
                <path
                    fill="currentColor"
                    d="m3.3 2.6 18 18-1.4 1.4-18-18L3.3 2.6Z"
                />
            )}
        </svg>
    );
};

const FakeDeafenButton: ChatBarButtonFactory = ({ isMainChat }) => {
    const { active: enabled, chatButton } = settings.use(["active", "chatButton"]);

    if (!isMainChat || !chatButton) return null;

    return (
        <ChatBarButton
            tooltip={enabled
                ? "Casque fantôme ACTIF — les autres te voient muet, ton micro émet"
                : "Casque fantôme : apparais muet casque tout en parlant"}
            onClick={() => setFakeDeafen(!settings.store.active)}
        >
            <FakeDeafenIcon />
        </ChatBarButton>
    );
};

// icône compacte 20x20 pour le panneau vocal (barré/rouge quand actif)
function PanelIcon() {
    const { active: enabled } = settings.use(["active"]);
    return (
        <svg width="20" height="20" viewBox="0 0 24 24">
            <path
                fill={enabled ? "var(--status-danger)" : "currentColor"}
                d="M12 3a9 9 0 0 0-9 9v7a2 2 0 0 0 2 2h3a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H5v-1a7 7 0 1 1 14 0v1h-3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h3a2 2 0 0 0 2-2v-7a9 9 0 0 0-9-9Z"
            />
            {enabled && (
                <path fill="var(--status-danger)" d="M3.3 2.6 21.4 20.7l-1.4 1.4L1.9 4 3.3 2.6Z" />
            )}
        </svg>
    );
}

function FakeDeafenPanelButton(props?: { nameplate?: any; }) {
    const { active: enabled, panelButton } = settings.use(["active", "panelButton"]);

    if (!panelButton) return null;
    // garde défensive : le patch passe `arguments[0]`, qui peut être undefined
    // (ou un mauvais objet) si le composant Discord patché est une fonction
    // fléchée. On ne lit props qu'avec `?.` pour ne jamais faire planter le rendu.

    return (
        <PanelButton
            tooltipText={enabled
                ? "Casque fantôme ACTIF — tu parais muet, ton micro émet"
                : "Casque fantôme : parais muet casque tout en parlant"}
            icon={PanelIcon}
            role="switch"
            aria-checked={enabled}
            redGlow={enabled}
            plated={props?.nameplate != null}
            onClick={() => setFakeDeafen(!settings.store.active)}
        />
    );
}

export default definePlugin({
    name: "FakeDeafen",
    description: "Apparais casque/micro coupé aux yeux des autres tout en continuant de parler (et optionnellement couper vraiment ton casque).",
    authors: [{ name: "Saliox", id: 0n }],
    tags: ["Voice", "Utility"],
    settings,

    patches: [
        {
            // module gateway : construction du paquet voiceStateUpdate (op 4)
            find: GATEWAY_MODULE_FIND,
            replacement: {
                match: /self_mute:(\i),self_deaf:(\i),self_video:(\i)/,
                replace: "self_mute:$self.fakeMute($1),self_deaf:$self.fakeDeaf($2),self_video:$3"
            }
        },
        {
            // panneau de compte : injecte le bouton à côté du micro/casque/paramètres
            // NOTE (correctif partiel) : `arguments[0]` est fragile — si le composant
            // patché est une fonction fléchée, `arguments` peut ne pas exister (ou
            // pointer sur le mauvais scope). renderPanelButton est rendu défensif
            // (props optionnels + ?.) pour éviter un crash du rendu, mais la source
            // des props reste `arguments[0]` : réécrire ce matcher demande un test
            // runtime impossible ici, donc on le laisse tel quel volontairement.
            find: "#{intl::USER_PROFILE_ACCOUNT_POPOUT_BUTTON_A11Y_LABEL}",
            replacement: {
                match: /children:\[(?=.{0,25}?accountContainerRef)/,
                replace: "children:[$self.renderPanelButton(arguments[0]),"
            }
        }
    ],

    fakeDeaf(real: boolean) {
        return settings.store.active && settings.store.fakeDeaf ? true : real;
    },

    fakeMute(real: boolean) {
        return settings.store.active && settings.store.fakeMute ? true : real;
    },

    renderPanelButton: ErrorBoundary.wrap(FakeDeafenPanelButton, { noop: true }),

    chatBarButton: {
        icon: FakeDeafenIcon,
        render: FakeDeafenButton
    },

    start() {
        // Migration UNIQUE : l'ancien défaut coupait vraiment le casque (cutOutput=true),
        // donc on n'entendait plus personne. On le désactive une fois pour toutes, et on
        // rétablit le volume s'il est resté coincé à 0 par l'ancienne version.
        // (Ne PAS rétablir le volume à chaque démarrage : l'utilisateur a le droit de
        //  régler son volume à 0 lui-même.)
        if (!settings.store.migrated) {
            settings.store.cutOutput = false;
            settings.store.migrated = true;
            try {
                if (MediaEngineStore.getOutputVolume() === 0) {
                    AudioActions.setOutputVolume(settings.store.savedVolume || 100);
                }
            } catch { /* store vocal pas prêt */ }
        }

        patchWarningShown = false;
        // léger délai pour laisser le module webpack visé le temps d'être enregistré ;
        // ne concerne que l'avertissement (ex. si `active` était déjà true à la reprise
        // d'une session précédente) — le check au toggle (setFakeDeafen) reste immédiat.
        patchCheckTimer = window.setTimeout(() => {
            patchCheckTimer = undefined;
            checkPatchAndWarn();
        }, 5000);
    },

    stop() {
        if (patchCheckTimer) window.clearTimeout(patchCheckTimer);
        patchCheckTimer = undefined;

        // ne jamais laisser le casque réellement coupé en désactivant le plugin — se fie à
        // volumeCutApplied (l'état réellement appliqué), pas à cutOutput (voir setFakeDeafen)
        if (settings.store.volumeCutApplied) {
            // nullish : respecte un vrai 0 sauvegardé
            AudioActions.setOutputVolume(settings.store.savedVolume ?? 100);
            settings.store.volumeCutApplied = false;
        }
        settings.store.active = false;
        // rediffuse le vrai état vocal : sinon on reste "sourd" aux yeux des
        // autres jusqu'à un toggle manuel / une reconnexion (le patch lisait
        // settings.store.active en direct, désormais remis à false).
        resendVoiceState();
    },

    settingsAboutComponent: () => {
        const patchStatus = verifyGatewayPatch();
        if (patchStatus !== false) return null;

        return (
            <Forms.FormText style={{ color: "var(--status-danger)" }} className={Margins.bottom8}>
                ⚠️ Le patch interne (passerelle) semble ne PAS être appliqué (mise à jour de Discord ?).
                <b> Le casque fantôme n'offre actuellement AUCUNE protection réelle</b> : ton vrai état
                vocal (micro/casque) est envoyé tel quel aux autres.
                <br />
                ⚠️ Internal gateway patch check FAILED (Discord update?). <b>FakeDeafen currently
                provides NO real protection</b> — your true mic/deafen state is sent as-is.
            </Forms.FormText>
        );
    }
});
