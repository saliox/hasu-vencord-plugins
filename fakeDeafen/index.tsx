/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { IconComponent, OptionType } from "@utils/types";
import { findByPropsLazy, findComponentByCodeLazy, findStoreLazy } from "@webpack";
import { SelectedChannelStore, showToast, Toasts } from "@webpack/common";

const VoiceActions = findByPropsLazy("toggleSelfMute", "toggleSelfDeaf");
const AudioActions = findByPropsLazy("setOutputVolume", "setInputVolume");
const MediaEngineStore = findStoreLazy("MediaEngineStore");
// bouton du panneau vocal (à côté du micro / casque / paramètres)
const PanelButton = findComponentByCodeLazy(".GREEN,positionKeyStemOverride:");

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
        // applique le changement en direct : sans ça, décocher cutOutput pendant que le
        // casque fantôme est actif laissait le volume coincé à 0 jusqu'au prochain toggle
        // de `active` (rien ne rétablissait le son tout de suite).
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

// applique (ou annule) la coupure réelle du volume selon l'état courant de
// `active` et `cutOutput`. Appelée à l'activation/désactivation du casque
// fantôme ET quand `cutOutput` change en direct (voir son onChange) : sinon
// décocher cutOutput pendant que le casque fantôme est actif ne faisait rien
// tant qu'on n'avait pas retoggle `active` (volume coincé à 0).
function applyCutOutput() {
    if (settings.store.active && settings.store.cutOutput) {
        if (!settings.store.volumeCutApplied) {
            // capture le volume réel AVANT de forcer à 0, sans condition :
            // si l'utilisateur avait déjà 0, on doit restaurer 0 (pas un défaut 100).
            settings.store.savedVolume = MediaEngineStore.getOutputVolume();
            AudioActions.setOutputVolume(0);
            settings.store.volumeCutApplied = true;
        }
    } else if (settings.store.volumeCutApplied) {
        // On se fie à `volumeCutApplied` (ce qui a été RÉELLEMENT appliqué), pas à la valeur
        // courante de `cutOutput` : si l'utilisateur décoche ce réglage pendant que le casque
        // fantôme est actif, le volume restait coincé à 0 pour de bon (rien ne le restaurait
        // plus jamais, ni ce toggle ni stop()).
        AudioActions.setOutputVolume(settings.store.savedVolume ?? 100);
        settings.store.volumeCutApplied = false;
    }
}

function setFakeDeafen(value: boolean) {
    settings.store.active = value;
    applyCutOutput();

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
            find: '"REQUEST_CHANNEL_INFO"',
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
    },

    stop() {
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
    }
});
