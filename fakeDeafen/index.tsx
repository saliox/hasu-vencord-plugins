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
        description: "Couper réellement ton casque quand c'est activé (tu n'entends plus rien, mais ton micro continue d'émettre)",
        default: true
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
    enabled: {
        type: OptionType.BOOLEAN,
        description: "État actuel",
        default: false,
        hidden: true
    },
    savedVolume: {
        type: OptionType.NUMBER,
        description: "Volume de sortie sauvegardé",
        default: 100,
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

function setFakeDeafen(value: boolean) {
    settings.store.enabled = value;

    if (settings.store.cutOutput) {
        if (value) {
            const current = MediaEngineStore.getOutputVolume();
            if (current > 0) settings.store.savedVolume = current;
            AudioActions.setOutputVolume(0);
        } else {
            AudioActions.setOutputVolume(settings.store.savedVolume || 100);
        }
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
    const { enabled } = settings.use(["enabled"]);
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
    const { enabled, chatButton } = settings.use(["enabled", "chatButton"]);

    if (!isMainChat || !chatButton) return null;

    return (
        <ChatBarButton
            tooltip={enabled
                ? "Casque fantôme ACTIF — les autres te voient muet, ton micro émet"
                : "Casque fantôme : apparais muet casque tout en parlant"}
            onClick={() => setFakeDeafen(!settings.store.enabled)}
        >
            <FakeDeafenIcon />
        </ChatBarButton>
    );
};

// icône compacte 20x20 pour le panneau vocal (barré/rouge quand actif)
function PanelIcon() {
    const { enabled } = settings.use(["enabled"]);
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

function FakeDeafenPanelButton(props: { nameplate?: any; }) {
    const { enabled, panelButton } = settings.use(["enabled", "panelButton"]);

    if (!panelButton) return null;

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
            onClick={() => setFakeDeafen(!settings.store.enabled)}
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
            find: "#{intl::USER_PROFILE_ACCOUNT_POPOUT_BUTTON_A11Y_LABEL}",
            replacement: {
                match: /children:\[(?=.{0,25}?accountContainerRef)/,
                replace: "children:[$self.renderPanelButton(arguments[0]),"
            }
        }
    ],

    fakeDeaf(real: boolean) {
        return settings.store.enabled && settings.store.fakeDeaf ? true : real;
    },

    fakeMute(real: boolean) {
        return settings.store.enabled && settings.store.fakeMute ? true : real;
    },

    renderPanelButton: ErrorBoundary.wrap(FakeDeafenPanelButton, { noop: true }),

    // API pour la barre de contrôle Hasu (HasuControlBar)
    hasuToggle() {
        setFakeDeafen(!settings.store.enabled);
    },
    hasuActive() {
        return settings.store.enabled;
    },

    chatBarButton: {
        icon: FakeDeafenIcon,
        render: FakeDeafenButton
    },

    stop() {
        // ne jamais laisser le casque réellement coupé en désactivant le plugin
        if (settings.store.enabled && settings.store.cutOutput) {
            AudioActions.setOutputVolume(settings.store.savedVolume || 100);
        }
        settings.store.enabled = false;
    }
});
