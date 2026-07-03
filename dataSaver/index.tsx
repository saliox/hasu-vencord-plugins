/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import { classNameFactory } from "@utils/css";
import { Margins } from "@utils/margins";
import definePlugin, { IconComponent, OptionType } from "@utils/types";
import { RenderModalProps } from "@vencord/discord-types";
import { findStoreLazy } from "@webpack";
import {
    Button,
    Forms,
    Modal,
    openModal,
    RunningGameStore,
    showToast,
    Text,
    Toasts,
    useEffect,
    useState
} from "@webpack/common";

const cl = classNameFactory("vc-datasaver-");

const RTCConnectionStore = findStoreLazy("RTCConnectionStore");

// réglages Discord (synchronisés au compte) pilotés par le mode éco
const GifAutoPlay = getUserSettingLazy<boolean>("textAndImages", "gifAutoPlay")!;
const AnimateEmoji = getUserSettingLazy<boolean>("textAndImages", "animateEmoji")!;
const AnimateStickers = getUserSettingLazy<number>("textAndImages", "animateStickers")!;
const RenderEmbeds = getUserSettingLazy<boolean>("textAndImages", "renderEmbeds")!;
const InlineAttachmentMedia = getUserSettingLazy<boolean>("textAndImages", "inlineAttachmentMedia")!;
const InlineEmbedMedia = getUserSettingLazy<boolean>("textAndImages", "inlineEmbedMedia")!;

const settings = definePluginSettings({
    autoGame: {
        type: OptionType.BOOLEAN,
        description: "Mode auto : activer l'éco quand un jeu est détecté, désactiver quand il se ferme",
        default: true
    },
    cutEmbeds: {
        type: OptionType.BOOLEAN,
        description: "Éco : couper les aperçus de liens (embeds)",
        default: true
    },
    cutInlineMedia: {
        type: OptionType.BOOLEAN,
        description: "Éco : ne plus charger les images/pièces jointes dans le chat (clic pour ouvrir)",
        default: true
    },
    cutGifAutoPlay: {
        type: OptionType.BOOLEAN,
        description: "Éco : stopper la lecture automatique des GIFs",
        default: true
    },
    cutAnimations: {
        type: OptionType.BOOLEAN,
        description: "Éco : figer les emojis et stickers animés",
        default: true
    },
    ecoActive: {
        type: OptionType.BOOLEAN,
        description: "Mode éco actif",
        default: false,
        hidden: true
    },
    autoEngaged: {
        type: OptionType.BOOLEAN,
        description: "Éco déclenché automatiquement par un jeu",
        default: false,
        hidden: true
    },
    savedPrefs: {
        type: OptionType.STRING,
        description: "Réglages Discord sauvegardés avant le mode éco",
        default: "",
        hidden: true
    }
});

function enableEco(auto = false) {
    if (settings.store.ecoActive) return;

    const saved: Record<string, unknown> = {};
    if (settings.store.cutGifAutoPlay) {
        saved.gifAutoPlay = GifAutoPlay.getSetting();
        GifAutoPlay.updateSetting(false);
    }
    if (settings.store.cutAnimations) {
        saved.animateEmoji = AnimateEmoji.getSetting();
        saved.animateStickers = AnimateStickers.getSetting();
        AnimateEmoji.updateSetting(false);
        AnimateStickers.updateSetting(2); // 2 = ne jamais animer
    }
    if (settings.store.cutEmbeds) {
        saved.renderEmbeds = RenderEmbeds.getSetting();
        RenderEmbeds.updateSetting(false);
    }
    if (settings.store.cutInlineMedia) {
        saved.inlineAttachmentMedia = InlineAttachmentMedia.getSetting();
        saved.inlineEmbedMedia = InlineEmbedMedia.getSetting();
        InlineAttachmentMedia.updateSetting(false);
        InlineEmbedMedia.updateSetting(false);
    }

    settings.store.savedPrefs = JSON.stringify(saved);
    settings.store.ecoActive = true;
    settings.store.autoEngaged = auto;
}

function disableEco() {
    if (!settings.store.ecoActive) return;

    let saved: Record<string, any>;
    try {
        saved = JSON.parse(settings.store.savedPrefs || "{}");
    } catch {
        saved = {};
    }

    if ("gifAutoPlay" in saved) GifAutoPlay.updateSetting(saved.gifAutoPlay);
    if ("animateEmoji" in saved) AnimateEmoji.updateSetting(saved.animateEmoji);
    if ("animateStickers" in saved) AnimateStickers.updateSetting(saved.animateStickers);
    if ("renderEmbeds" in saved) RenderEmbeds.updateSetting(saved.renderEmbeds);
    if ("inlineAttachmentMedia" in saved) InlineAttachmentMedia.updateSetting(saved.inlineAttachmentMedia);
    if ("inlineEmbedMedia" in saved) InlineEmbedMedia.updateSetting(saved.inlineEmbedMedia);

    settings.store.savedPrefs = "";
    settings.store.ecoActive = false;
    settings.store.autoEngaged = false;
}

function toggleEco() {
    if (settings.store.ecoActive) {
        disableEco();
        showToast("Mode éco désactivé : réglages d'origine restaurés", Toasts.Type.SUCCESS);
    } else {
        enableEco(false);
        showToast("Mode éco activé : embeds/images/GIFs coupés selon tes réglages", Toasts.Type.SUCCESS);
    }
}

function pingVerdict(ms: number) {
    if (ms < 0) return { label: "mesure impossible", cls: "bad" };
    if (ms < 80) return { label: "bonne connexion", cls: "good" };
    if (ms < 180) return { label: "connexion moyenne", cls: "mid" };
    return { label: "connexion lente — mode éco recommandé", cls: "bad" };
}

function StatusModal(props: RenderModalProps) {
    const { ecoActive, autoGame } = settings.use(["ecoActive", "autoGame"]);
    const [ping, setPing] = useState<number | null>(null);
    const [testing, setTesting] = useState(false);

    async function testPing() {
        setTesting(true);
        // mesure de latence HTTP vers discord.com uniquement — aucune IP
        // collectée ni stockée, rien ne quitte cette fenêtre
        const samples: number[] = [];
        for (let i = 0; i < 3; i++) {
            const t0 = performance.now();
            try {
                await fetch("https://discord.com/api/v10/gateway", { cache: "no-store" });
                samples.push(performance.now() - t0);
            } catch {
                // hors-ligne ou bloqué : ignoré, le verdict passera en "mesure impossible"
            }
        }
        setPing(samples.length ? Math.round(Math.min(...samples)) : -1);
        setTesting(false);
    }

    useEffect(() => {
        testPing();
    }, []);

    const conn = (navigator as any).connection;
    const connType: string | undefined = conn?.type;
    const downlink: number | undefined = conn?.downlink;

    let voicePing: number | undefined;
    try {
        voicePing = RTCConnectionStore?.getLastPing?.();
    } catch {
        voicePing = undefined;
    }

    const games: Array<{ name?: string; }> = RunningGameStore.getRunningGames() ?? [];
    const verdict = ping != null ? pingVerdict(ping) : null;

    return (
        <Modal
            {...props}
            size="md"
            title="DataSaver — état de la connexion"
            actions={[
                {
                    text: ecoActive ? "Désactiver le mode éco" : "Activer le mode éco",
                    variant: "primary",
                    onClick: () => toggleEco()
                },
                { text: "Retester le ping", variant: "secondary", disabled: testing, onClick: testPing }
            ]}
        >
            <div className={cl("row")}>
                <Text variant="text-md/semibold">Mode éco</Text>
                <Text variant="text-md/normal" className={cl(ecoActive ? "good" : "muted")}>
                    {ecoActive ? (settings.store.autoEngaged ? "actif (auto, jeu détecté)" : "actif (manuel)") : "inactif"}
                </Text>
            </div>
            <div className={cl("row")}>
                <Text variant="text-md/semibold">Mode auto jeu</Text>
                <Text variant="text-md/normal" className={cl("muted")}>
                    {autoGame ? "activé" : "désactivé"} — jeu en cours : {games.length ? games.map(g => g.name ?? "?").join(", ") : "aucun"}
                </Text>
            </div>
            <div className={cl("row")}>
                <Text variant="text-md/semibold">Ping API Discord</Text>
                <Text variant="text-md/normal" className={verdict ? cl(verdict.cls) : cl("muted")}>
                    {testing ? "mesure en cours…" : ping == null ? "—" : ping < 0 ? "échec" : `${ping} ms`}
                    {verdict && !testing ? ` (${verdict.label})` : ""}
                </Text>
            </div>
            <div className={cl("row")}>
                <Text variant="text-md/semibold">Ping vocal</Text>
                <Text variant="text-md/normal" className={cl("muted")}>
                    {typeof voicePing === "number" && voicePing > 0 ? `${Math.round(voicePing)} ms` : "pas en vocal"}
                </Text>
            </div>
            <div className={cl("row")}>
                <Text variant="text-md/semibold">Interface réseau</Text>
                <Text variant="text-md/normal" className={cl("muted")}>
                    {connType === "wifi" ? "Wi-Fi" : connType === "ethernet" ? "Ethernet" : "non exposée par le système"}
                    {typeof downlink === "number" ? ` — débit estimé ${downlink} Mb/s` : ""}
                </Text>
            </div>

            <Forms.FormText className={Margins.top16}>
                Confidentialité : la mesure de ping n'interroge que discord.com ; aucune adresse IP n'est
                collectée ni conservée.
            </Forms.FormText>
            <Forms.FormText className={Margins.top8}>
                Choisir Wi-Fi ou Ethernet pour Discord seul n'est pas possible depuis un plugin (c'est le
                système qui route le trafic). Astuce : branche l'Ethernet et Windows le préférera
                automatiquement ; sinon désactive le Wi-Fi le temps de jouer.
            </Forms.FormText>
        </Modal>
    );
}

const DataSaverIcon: IconComponent = ({ height = 20, width = 20, className }) => {
    const { ecoActive } = settings.use(["ecoActive"]);
    return (
        <svg
            width={width}
            height={height}
            className={className}
            viewBox="0 0 24 24"
            style={{ scale: "1.1", color: ecoActive ? "var(--status-positive)" : "currentcolor" }}
        >
            <path
                fill="currentColor"
                d="M12 4a10 10 0 0 0-8.66 15 1 1 0 0 0 1.73-1A8 8 0 1 1 20 12a7.9 7.9 0 0 1-1.07 4 1 1 0 0 0 1.73 1A10 10 0 0 0 12 4Zm4.24 5.17a1 1 0 0 0-1.41 0l-3.54 3.54a2 2 0 1 0 1.41 1.41l3.54-3.54a1 1 0 0 0 0-1.41Z"
            />
        </svg>
    );
};

const DataSaverButton: ChatBarButtonFactory = ({ isMainChat }) => {
    const { ecoActive } = settings.use(["ecoActive"]);

    if (!isMainChat) return null;

    return (
        <ChatBarButton
            tooltip={ecoActive
                ? "Mode éco ACTIF — clic : désactiver, clic droit : état de la connexion"
                : "DataSaver — clic : mode éco, clic droit : état de la connexion"}
            onClick={toggleEco}
            onContextMenu={e => {
                e.preventDefault();
                openModal(p => <StatusModal {...p} />);
            }}
            buttonProps={{ "aria-haspopup": "dialog" }}
        >
            <DataSaverIcon />
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "DataSaver",
    description: "Réduit la consommation internet de Discord (embeds, images, GIFs, animations) avec mode auto quand un jeu tourne, et analyse ta connexion sans collecter d'IP.",
    authors: [{ name: "Saliox", id: 0n }],
    tags: ["Utility", "Media"],
    dependencies: ["UserSettingsAPI"],
    settings,

    chatBarButton: {
        icon: DataSaverIcon,
        render: DataSaverButton
    },

    // API pour la barre de contrôle Hasu (HasuControlBar)
    hasuToggle() {
        toggleEco();
    },
    hasuActive() {
        return settings.store.ecoActive;
    },

    flux: {
        RUNNING_GAMES_CHANGE({ games }: { games: unknown[]; }) {
            if (!settings.store.autoGame) return;

            if (games.length > 0 && !settings.store.ecoActive) {
                enableEco(true);
                showNotification({
                    title: "DataSaver",
                    body: "Jeu détecté : mode éco activé pour libérer ta connexion. Il se coupera à la fermeture du jeu."
                });
            } else if (games.length === 0 && settings.store.ecoActive && settings.store.autoEngaged) {
                disableEco();
                showToast("Jeu fermé : mode éco désactivé, réglages restaurés", Toasts.Type.SUCCESS);
            }
        }
    },

    settingsAboutComponent: () => (
        <>
            <Forms.FormText className={Margins.bottom8}>
                Clic sur la jauge dans la barre de message : active/coupe le mode éco. Clic droit :
                panneau d'état (ping, jeu détecté, interface réseau).
            </Forms.FormText>
            <Forms.FormText>
                Le mode éco modifie des réglages Discord synchronisés à ton compte (GIFs, embeds,
                images) et les restaure à l'identique quand il se désactive.
            </Forms.FormText>
        </>
    )
});
