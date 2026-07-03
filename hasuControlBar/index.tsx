/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings, Settings, useSettings } from "@api/Settings";
import { classNameFactory } from "@utils/css";
import { Margins } from "@utils/margins";
import definePlugin, { OptionType } from "@utils/types";
import { createRoot, Forms, React, showToast, Toasts, Tooltip } from "@webpack/common";

const cl = classNameFactory("vc-hasubar-");

type Action = "toggle" | "open";

interface ToggleDef {
    /** nom du plugin cible (clé dans Vencord.Plugins.plugins) */
    id: string;
    label: string;
    /** clé de réglage reflétant l'état actif (pour la couleur), ou null si simple action */
    stateKey: string | null;
    action: Action;
    /** nom du réglage de raccourci de ce plugin */
    shortcut: string;
    color: string;
    /** chemin SVG (string). PAS un élément JSX : créer du JSX au niveau module
     *  invoque React avant que Vencord soit prêt et casse tout le renderer. */
    icon: string;
}

const ICON = {
    data: "M12 4a10 10 0 0 0-8.66 15 1 1 0 0 0 1.73-1A8 8 0 1 1 20 12a7.9 7.9 0 0 1-1.07 4 1 1 0 0 0 1.73 1A10 10 0 0 0 12 4Zm4.24 5.17a1 1 0 0 0-1.41 0l-3.54 3.54a2 2 0 1 0 1.41 1.41l3.54-3.54a1 1 0 0 0 0-1.41Z",
    deaf: "M12 3a9 9 0 0 0-9 9v7a2 2 0 0 0 2 2h3a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H5v-1a7 7 0 1 1 14 0v1h-3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h3a2 2 0 0 0 2-2v-7a9 9 0 0 0-9-9Z",
    mask: "M20.5 6c-2.6 0-4.9.8-6.5 2.1H10C8.4 6.8 6.1 6 3.5 6 2.7 6 2 6.7 2 7.5v4C2 14 4 16 6.5 16c2.2 0 4-1.5 4.4-3.5.2-.9 1-1.5 1.1-1.5s.9.6 1.1 1.5c.4 2 2.2 3.5 4.4 3.5 2.5 0 4.5-2 4.5-4.5v-4c0-.8-.7-1.5-1.5-1.5ZM6.5 14C5.1 14 4 12.9 4 11.5S5.1 9 6.5 9 9 10.1 9 11.5 7.9 14 6.5 14Zm11 0c-1.4 0-2.5-1.1-2.5-2.5S16.1 9 17.5 9 20 10.1 20 11.5 18.9 14 17.5 14Z",
    clock: "M12 2a10 10 0 1 0 10 10A10.011 10.011 0 0 0 12 2Zm0 18a8 8 0 1 1 8-8 8.009 8.009 0 0 1-8 8Zm.5-13H11v6.42l4.9 2.94.77-1.28-4.17-2.5Z"
};

const TOGGLES: ToggleDef[] = [
    { id: "DataSaver", label: "Mode éco data", stateKey: "ecoActive", action: "toggle", shortcut: "keyDataSaver", color: "var(--status-positive, #23a55a)", icon: ICON.data },
    { id: "FakeDeafen", label: "Casque fantôme", stateKey: "enabled", action: "toggle", shortcut: "keyFakeDeafen", color: "var(--status-danger, #f23f43)", icon: ICON.deaf },
    { id: "StreamAnonymizer", label: "Anonymat stream", stateKey: "enabled", action: "toggle", shortcut: "keyStreamAnonymizer", color: "var(--status-danger, #f23f43)", icon: ICON.mask },
    { id: "SendLater", label: "Messages planifiés", stateKey: null, action: "open", shortcut: "keySendLater", color: "var(--brand-500, #5865f2)", icon: ICON.clock }
];

const settings = definePluginSettings({
    showBar: {
        type: OptionType.BOOLEAN,
        description: "Afficher la barre flottante à l'écran",
        default: true
    },
    orientation: {
        type: OptionType.SELECT,
        description: "Sens de la barre",
        options: [
            { label: "Verticale", value: "vertical", default: true },
            { label: "Horizontale", value: "horizontal" }
        ]
    },
    keyDataSaver: {
        type: OptionType.STRING,
        description: "Raccourci — Mode éco data (ex. Ctrl+Alt+E). Vide = aucun.",
        default: ""
    },
    keyFakeDeafen: {
        type: OptionType.STRING,
        description: "Raccourci — Casque fantôme (ex. Ctrl+Alt+D). Vide = aucun.",
        default: ""
    },
    keyStreamAnonymizer: {
        type: OptionType.STRING,
        description: "Raccourci — Anonymat stream (ex. Ctrl+Alt+S). Vide = aucun.",
        default: ""
    },
    keySendLater: {
        type: OptionType.STRING,
        description: "Raccourci — Ouvrir les messages planifiés (ex. Ctrl+Alt+L). Vide = aucun.",
        default: ""
    },
    keyToggleBar: {
        type: OptionType.STRING,
        description: "Raccourci — Afficher/masquer la barre (ex. Ctrl+Alt+B). Vide = aucun.",
        default: ""
    },
    posX: { type: OptionType.NUMBER, description: "position X", default: 24, hidden: true },
    posY: { type: OptionType.NUMBER, description: "position Y", default: 140, hidden: true }
});

// ---- raccourcis clavier -----------------------------------------------------

function canonical(combo: string): string {
    const parts = combo.toLowerCase().replace(/\s+/g, "").split("+").filter(Boolean);
    const mods: string[] = [];
    let key = "";
    for (const p of parts) {
        if (p === "control" || p === "ctrl") mods.includes("ctrl") || mods.push("ctrl");
        else if (p === "shift") mods.includes("shift") || mods.push("shift");
        else if (p === "alt" || p === "option") mods.includes("alt") || mods.push("alt");
        else if (p === "meta" || p === "cmd" || p === "win" || p === "super") mods.includes("meta") || mods.push("meta");
        else key = p;
    }
    const order = ["ctrl", "shift", "alt", "meta"].filter(m => mods.includes(m));
    return [...order, key].filter(Boolean).join("+");
}

function eventCanonical(e: KeyboardEvent): string {
    const mods: string[] = [];
    if (e.ctrlKey) mods.push("ctrl");
    if (e.shiftKey) mods.push("shift");
    if (e.altKey) mods.push("alt");
    if (e.metaKey) mods.push("meta");
    let key = (e.key || "").toLowerCase();
    if (["control", "shift", "alt", "meta"].includes(key)) key = "";
    if (key === " ") key = "space";
    return [...mods, key].filter(Boolean).join("+");
}

function fire(t: ToggleDef) {
    if (!isPluginEnabled(t.id)) {
        showToast(`${t.label} : le plugin « ${t.id} » est désactivé`, Toasts.Type.FAILURE);
        return;
    }
    const plugin: any = (window as any).Vencord?.Plugins?.plugins?.[t.id];
    if (t.action === "open") plugin?.hasuOpen?.();
    else plugin?.hasuToggle?.();
}

function onKeyDown(e: KeyboardEvent) {
    // exige un modificateur fort pour ne jamais gêner la frappe
    if (!(e.ctrlKey || e.altKey || e.metaKey)) return;

    const pressed = eventCanonical(e);
    if (!pressed) return;

    if (settings.store.keyToggleBar && canonical(settings.store.keyToggleBar) === pressed) {
        e.preventDefault();
        settings.store.showBar = !settings.store.showBar;
        return;
    }

    for (const t of TOGGLES) {
        const combo = (settings.store as any)[t.shortcut] as string;
        if (combo && canonical(combo) === pressed) {
            e.preventDefault();
            fire(t);
            return;
        }
    }
}

// ---- rendu de la barre ------------------------------------------------------

function isActive(t: ToggleDef): boolean {
    if (!t.stateKey) return false;
    try {
        return !!(Settings.plugins as any)?.[t.id]?.[t.stateKey];
    } catch {
        return false;
    }
}

function shortcutLabel(t: ToggleDef): string {
    const combo = (settings.store as any)[t.shortcut] as string;
    return combo ? canonical(combo).toUpperCase() : "";
}

function Bar() {
    useSettings([
        "plugins.HasuControlBar.showBar",
        "plugins.HasuControlBar.orientation",
        "plugins.HasuControlBar.posX",
        "plugins.HasuControlBar.posY",
        "plugins.DataSaver.ecoActive",
        "plugins.FakeDeafen.enabled",
        "plugins.StreamAnonymizer.enabled"
    ]);

    const [pos, setPos] = React.useState({ x: settings.store.posX, y: settings.store.posY });
    const dragRef = React.useRef<{ dx: number; dy: number; } | null>(null);

    if (!settings.store.showBar) return null;

    const visible = TOGGLES.filter(t => isPluginEnabled(t.id));
    if (visible.length === 0) return null;

    const horizontal = settings.store.orientation === "horizontal";

    function onPointerDownDrag(e: React.PointerEvent) {
        e.preventDefault();
        dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
    function onPointerMove(e: React.PointerEvent) {
        if (!dragRef.current) return;
        const x = Math.max(0, Math.min(window.innerWidth - 40, e.clientX - dragRef.current.dx));
        const y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dragRef.current.dy));
        setPos({ x, y });
    }
    function onPointerUp(e: React.PointerEvent) {
        if (dragRef.current) {
            // persistance uniquement au relâchement (évite d'écrire sur disque à chaque pixel)
            settings.store.posX = pos.x;
            settings.store.posY = pos.y;
        }
        dragRef.current = null;
        try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { }
    }

    return (
        <div
            className={cl("root", { horizontal })}
            style={{ left: pos.x, top: pos.y }}
        >
            <div
                className={cl("grip")}
                onPointerDown={onPointerDownDrag}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                aria-label="Déplacer la barre"
            >
                <svg width="14" height="14" viewBox="0 0 24 24"><path fill="currentColor" d="M9 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm10 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM9 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm10 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM9 20a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm10 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z" /></svg>
            </div>

            {visible.map(t => {
                const active = isActive(t);
                const sc = shortcutLabel(t);
                return (
                    <Tooltip key={t.id} text={sc ? `${t.label} — ${sc}` : t.label}>
                        {({ onMouseEnter, onMouseLeave }) => (
                            <button
                                onMouseEnter={onMouseEnter}
                                onMouseLeave={onMouseLeave}
                                className={cl("btn", { active })}
                                style={active ? { color: t.color } : undefined}
                                onClick={() => fire(t)}
                            >
                                <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d={t.icon} /></svg>
                                {active && <span className={cl("dot")} style={{ background: t.color }} />}
                            </button>
                        )}
                    </Tooltip>
                );
            })}
        </div>
    );
}

// ---- montage / cycle de vie -------------------------------------------------

let root: ReturnType<typeof createRoot> | null = null;
let container: HTMLElement | null = null;

export default definePlugin({
    name: "HasuControlBar",
    // Bilingue / Bilingual
    description: "Floating taskbar + customizable hotkeys to toggle the Hasu plugins. / Barre des tâches flottante + raccourcis personnalisables pour piloter les plugins Hasu.",
    authors: [{ name: "Saliox", id: 0n }],
    tags: ["Utility", "Shortcuts"],
    settings,

    start() {
        document.addEventListener("keydown", onKeyDown, true);

        container = document.createElement("div");
        container.id = "vc-hasu-control-bar";
        document.body.appendChild(container);
        root = createRoot(container);
        root.render(<Bar />);
    },

    stop() {
        document.removeEventListener("keydown", onKeyDown, true);
        root?.unmount();
        root = null;
        container?.remove();
        container = null;
    },

    settingsAboutComponent: () => (
        <>
            <Forms.FormTitle>🇫🇷 Objectif</Forms.FormTitle>
            <Forms.FormText className={Margins.bottom8}>
                <b>HasuControlBar</b> ajoute une petite <b>barre des tâches flottante</b> (déplaçable : attrape la
                poignée en haut) pour activer/désactiver d'un clic tes plugins Hasu : Mode éco data, Casque fantôme,
                Anonymat stream, et ouvrir les messages planifiés.
            </Forms.FormText>
            <Forms.FormText className={Margins.bottom8}>
                Tu peux aussi définir un <b>raccourci clavier</b> pour chaque bascule dans les réglages ci-dessus
                (format : <code>Ctrl+Alt+D</code>, <code>Ctrl+Shift+E</code>…). Laisse vide pour ne pas en mettre.
                Un modificateur (Ctrl, Alt ou Cmd) est requis pour éviter d'interférer avec la frappe.
            </Forms.FormText>
            <Forms.FormText className={Margins.bottom8}>
                Seuls les plugins <b>activés</b> apparaissent dans la barre. Le bouton s'allume quand la fonction est active.
            </Forms.FormText>

            <Forms.FormTitle className={Margins.top16}>🇬🇧 Purpose</Forms.FormTitle>
            <Forms.FormText className={Margins.bottom8}>
                <b>HasuControlBar</b> adds a small <b>floating taskbar</b> (draggable via the top grip) to toggle your
                Hasu plugins in one click: data saver, fake deafen, stream anonymizer, and open scheduled messages.
            </Forms.FormText>
            <Forms.FormText>
                You can also set a <b>keyboard shortcut</b> per toggle in the settings above (e.g. <code>Ctrl+Alt+D</code>).
                Leave empty for none. A modifier (Ctrl, Alt or Cmd) is required so it never clashes with typing.
                Only <b>enabled</b> plugins show up in the bar.
            </Forms.FormText>
        </>
    )
});
