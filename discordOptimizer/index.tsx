/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { definePluginSettings } from "@api/Settings";
import { disableStyle, enableStyle } from "@api/Styles";
import { Margins } from "@utils/margins";
import definePlugin, { IconComponent, OptionType } from "@utils/types";
import { Forms, showToast, Toasts } from "@webpack/common";

import decoStyle from "./hideDecorations.css?managed";
import transStyle from "./instantUI.css?managed";
import blurStyle from "./reduceBlur.css?managed";

const settings = definePluginSettings({
    active: {
        type: OptionType.BOOLEAN,
        description: "Optimisation active (basculée par le bouton ⚡)",
        default: true,
        hidden: true
    },
    showButton: {
        type: OptionType.BOOLEAN,
        description: "Afficher le bouton ⚡ on/off dans la barre de message",
        default: true
    },
    reduceBlur: {
        type: OptionType.BOOLEAN,
        description: "Supprimer les flous d'arrière-plan (gros gain GPU sur les popouts/modales)",
        default: true,
        onChange: () => apply()
    },
    instantUI: {
        type: OptionType.BOOLEAN,
        description: "Transitions instantanées (interface plus légère et réactive)",
        default: true,
        onChange: () => apply()
    },
    hideDecorations: {
        type: OptionType.BOOLEAN,
        description: "Masquer les décorations d'avatar et plaques Nitro (rendu allégé)",
        default: false,
        onChange: () => apply()
    }
});

const STYLES: Array<[keyof typeof settings.store, string]> = [
    ["reduceBlur", blurStyle],
    ["instantUI", transStyle],
    ["hideDecorations", decoStyle]
];

// vrai seulement entre start() et stop() : évite qu'un onChange de réglage
// n'injecte le CSS alors que le plugin est désactivé.
let started = false;

function apply() {
    const on = started && settings.store.active;
    for (const [key, style] of STYLES) {
        if (on && settings.store[key]) enableStyle(style);
        else disableStyle(style);
    }
}

function toggleOptimizer() {
    settings.store.active = !settings.store.active;
    apply(); // effet immédiat, sans redémarrage
    showToast(
        settings.store.active
            ? "Optimisation activée"
            : "Optimisation désactivée (rendu Discord normal)",
        Toasts.Type.SUCCESS
    );
}

const OptiIcon: IconComponent = ({ height = 20, width = 20, className }) => {
    const { active } = settings.use(["active"]);
    return (
        <svg
            width={width}
            height={height}
            className={className}
            viewBox="0 0 24 24"
            style={{ scale: "1.1", color: active ? "var(--status-positive, #23a55a)" : "currentcolor" }}
        >
            <path
                fill="currentColor"
                d="M13 2 4.5 13H11l-1 9 9.5-12H13l0-8Z"
            />
            {!active && (
                <path fill="var(--status-danger, #f23f43)" d="M3.3 2.6 21.4 20.7l-1.4 1.4L1.9 4 3.3 2.6Z" />
            )}
        </svg>
    );
};

const OptiButton: ChatBarButtonFactory = ({ isMainChat }) => {
    const { active, showButton } = settings.use(["active", "showButton"]);

    if (!isMainChat || !showButton) return null;

    return (
        <ChatBarButton
            tooltip={active ? "Optimisation ACTIVE — clic pour désactiver" : "Optimisation désactivée — clic pour activer"}
            onClick={toggleOptimizer}
        >
            <OptiIcon />
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "DiscordOptimizer",
    // Bilingue / Bilingual
    description: "Allège le rendu de Discord (moins de flous GPU, transitions instantanées, décorations en option) sans jamais toucher aux messages, notifications ni pings. / Lightens Discord rendering (less GPU blur, instant transitions, optional decorations) without ever touching messages, notifications or pings.",
    authors: [{ name: "Saliox", id: 0n }],
    tags: ["Utility", "Appearance"],
    settings,

    chatBarButton: {
        icon: OptiIcon,
        render: OptiButton
    },

    start() {
        started = true;
        apply();
    },

    stop() {
        started = false;
        for (const [, style] of STYLES) disableStyle(style);
    },

    settingsAboutComponent: () => (
        <>
            <Forms.FormTitle>🇫🇷 Objectif</Forms.FormTitle>
            <Forms.FormText className={Margins.bottom8}>
                <b>DiscordOptimizer</b> allège Discord côté <b>rendu graphique</b> uniquement :
            </Forms.FormText>
            <Forms.FormText className={Margins.bottom8}>
                • <b>Moins de flous</b> — retire les <code>backdrop-filter</code>, gros consommateurs de GPU.<br />
                • <b>Transitions instantanées</b> — interface plus réactive.<br />
                • <b>Décorations</b> (option) — masque déco d'avatar et plaques Nitro.
            </Forms.FormText>
            <Forms.FormText className={Margins.bottom8}>
                ✅ <b>Tes notifications, mentions/pings et pastilles de messages non lus restent intacts</b> :
                le plugin ne touche qu'à l'affichage, jamais aux événements ni au réseau.
            </Forms.FormText>
            <Forms.FormText className={Margins.bottom8}>
                Les options s'appliquent <b>instantanément</b> (pas besoin de redémarrer).
            </Forms.FormText>

            <Forms.FormTitle className={Margins.top16}>🇬🇧 Purpose</Forms.FormTitle>
            <Forms.FormText className={Margins.bottom8}>
                <b>DiscordOptimizer</b> lightens Discord's <b>rendering</b> only: it removes expensive
                <code>backdrop-filter</code> blur and makes transitions instant (optionally hides decorations).
            </Forms.FormText>
            <Forms.FormText>
                ✅ <b>Your notifications, mentions/pings and unread badges stay intact</b> — it only affects
                display, never events or the network.
            </Forms.FormText>
        </>
    )
});
