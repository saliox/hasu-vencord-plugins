/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import * as DataStore from "@api/DataStore";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { classNameFactory } from "@utils/css";
import { getTheme, Theme } from "@utils/discord";
import { Margins } from "@utils/margins";
import definePlugin, { IconComponent, OptionType } from "@utils/types";
import { RenderModalProps } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import {
    Button,
    ChannelStore,
    Constants,
    DraftStore,
    DraftType,
    Forms,
    GuildStore,
    Modal,
    NavigationRouter,
    openModal,
    Parser,
    RestAPI,
    showToast,
    SnowflakeUtils,
    Text,
    TextArea,
    Toasts,
    useEffect,
    useState
} from "@webpack/common";

const cl = classNameFactory("vc-sendlater-");

const DraftManager = findByPropsLazy("clearDraft", "saveDraft");

const STORAGE_KEY = "SendLater_scheduled";
const SWEEP_INTERVAL = 5000;
const MAX_CONTENT_LENGTH = 2000;

interface ScheduledMessage {
    id: string;
    channelId: string;
    guildId?: string;
    content: string;
    dueAt: number;
    createdAt: number;
    /** l'heure est passée pendant que Discord était fermé : attend une action de l'utilisateur */
    paused?: boolean;
    /** dernière erreur d'envoi ; bloque les nouvelles tentatives automatiques */
    error?: string;
}

const settings = definePluginSettings({
    missedBehavior: {
        type: OptionType.SELECT,
        description: "Que faire des messages dont l'heure est passée pendant que Discord était fermé",
        options: [
            { label: "Me prévenir et attendre ma confirmation", value: "notify", default: true },
            { label: "Les envoyer dès le démarrage", value: "send" },
            { label: "Les abandonner", value: "drop" }
        ]
    },
    notifyOnSend: {
        type: OptionType.BOOLEAN,
        description: "Afficher une notification quand un message planifié est envoyé",
        default: true
    }
});

let scheduled: ScheduledMessage[] = [];
let sweepTimer: number | undefined;
const inFlight = new Set<string>();
const listeners = new Set<() => void>();

function save() {
    DataStore.set(STORAGE_KEY, scheduled);
    listeners.forEach(l => l());
}

function usePendingVersion() {
    const [, setVersion] = useState(0);
    useEffect(() => {
        const listener = () => setVersion(v => v + 1);
        listeners.add(listener);
        return () => void listeners.delete(listener);
    }, []);
}

function channelLabel(channelId: string) {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return "salon inconnu";
    if (channel.isDM?.()) return `@${(channel as any).rawRecipients?.[0]?.username ?? "MP"}`;
    if (channel.isGroupDM?.()) return channel.name || "Groupe privé";

    const guild = GuildStore.getGuild(channel.guild_id);
    return `#${channel.name}${guild ? ` — ${guild.name}` : ""}`;
}

function jumpToChannel(msg: ScheduledMessage) {
    NavigationRouter.transitionTo(`/channels/${msg.guildId ?? "@me"}/${msg.channelId}`);
}

function removeScheduled(id: string) {
    scheduled = scheduled.filter(m => m.id !== id);
    save();
}

function addScheduled(channelId: string, content: string, dueAt: number): ScheduledMessage {
    const channel = ChannelStore.getChannel(channelId);
    const msg: ScheduledMessage = {
        id: crypto.randomUUID(),
        channelId,
        guildId: channel?.guild_id ?? undefined,
        content,
        dueAt,
        createdAt: Date.now()
    };
    scheduled.push(msg);
    save();
    return msg;
}

/**
 * Convertit une saisie utilisateur en horodatage d'envoi.
 * Accepte les durées relatives ("10m", "1h30", "2h", "90s", "1d")
 * et les heures absolues du jour ("20:00", "9h30").
 * Renvoie null si la saisie est invalide ou dans le passé.
 */
const DURATION_UNITS: Record<string, number> = { d: 86400_000, j: 86400_000, h: 3600_000, m: 60_000, s: 1000 };

/**
 * Somme une durée. Un nombre SANS unité juste après h/j/d = minutes, après m =
 * secondes — ainsi "1h30" = 1 h 30 min (et pas "1 h" ni une heure d'horloge).
 */
function parseDuration(raw: string): number | null {
    const re = /(\d+)\s*([djhms]?)/g;
    let ms = 0, matched = false;
    let lastUnit: string | null = null;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
        const value = parseInt(m[1], 10);
        let unit = m[2];
        if (!unit) {
            if (lastUnit === "h" || lastUnit === "j" || lastUnit === "d") unit = "m";
            else if (lastUnit === "m") unit = "s";
            else return null; // nombre nu sans contexte (ex. "30")
        }
        ms += value * (DURATION_UNITS[unit] ?? 0);
        lastUnit = unit;
        matched = true;
    }
    return matched && ms > 0 ? ms : null;
}

function parseWhen(input: string): number | null {
    const raw = input.trim().toLowerCase();
    if (!raw) return null;

    // heure absolue = format à DEUX-POINTS uniquement (ex. 20:00), pour ne pas
    // confondre avec une durée type "1h30".
    const clock = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (clock) {
        const h = Number(clock[1]);
        const min = Number(clock[2]);
        if (h > 23 || min > 59) return null;
        const d = new Date();
        d.setHours(h, min, 0, 0);
        if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
        return d.getTime();
    }

    // durée relative
    const ms = parseDuration(raw);
    return ms == null ? null : Date.now() + ms;
}

async function sendScheduled(msg: ScheduledMessage) {
    if (inFlight.has(msg.id)) return;
    inFlight.add(msg.id);

    try {
        const res = await RestAPI.post({
            url: Constants.Endpoints.MESSAGES(msg.channelId),
            body: {
                content: msg.content,
                nonce: SnowflakeUtils.fromTimestamp(Date.now()),
                tts: false
            }
        });
        if (res?.ok === false) throw new Error(`HTTP ${res.status}`);

        removeScheduled(msg.id);
        if (settings.store.notifyOnSend) {
            showNotification({
                title: "Send Later",
                body: `Message envoyé dans ${channelLabel(msg.channelId)}`,
                onClick: () => jumpToChannel(msg)
            });
        }
    } catch (e: any) {
        msg.error = String(e?.body?.message ?? e?.message ?? e);
        save();
        showNotification({
            title: "Send Later — échec d'envoi",
            body: `Impossible d'envoyer le message planifié dans ${channelLabel(msg.channelId)} : ${msg.error}`,
            onClick: openListModal
        });
    } finally {
        inFlight.delete(msg.id);
    }
}

function sendNow(msg: ScheduledMessage) {
    msg.paused = false;
    msg.error = undefined;
    save();
    sendScheduled(msg);
}

function sweep() {
    const now = Date.now();
    for (const msg of [...scheduled]) {
        if (msg.dueAt <= now && !msg.paused && !msg.error) sendScheduled(msg);
    }
}

function toLocalInputValue(ts: number) {
    const d = new Date(ts);
    d.setSeconds(0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function nextHourAt(hour: number, addDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + addDays);
    d.setHours(hour, 0, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    return d.getTime();
}

const TIME_PRESETS: Array<[label: string, getTime: () => number]> = [
    ["+10 min", () => Date.now() + 10 * 60_000],
    ["+1 h", () => Date.now() + 60 * 60_000],
    ["Ce soir 20 h", () => nextHourAt(20)],
    ["Demain 9 h", () => nextHourAt(9, 1)]
];

function ScheduleModal({ channelId, ...props }: RenderModalProps & { channelId: string; }) {
    const [content, setContent] = useState(() => DraftStore.getDraft(channelId, DraftType.ChannelMessage) ?? "");
    const [when, setWhen] = useState(() => toLocalInputValue(Date.now() + 10 * 60_000));

    const dueAt = new Date(when).getTime();
    const isTimeValid = !isNaN(dueAt) && dueAt > Date.now();
    const trimmed = content.trim();
    const isContentValid = trimmed.length > 0 && trimmed.length <= MAX_CONTENT_LENGTH;

    function schedule() {
        addScheduled(channelId, trimmed, dueAt);
        DraftManager.clearDraft(channelId, DraftType.ChannelMessage);
        props.onClose();
        showToast(
            `Message planifié pour ${new Date(dueAt).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}`,
            Toasts.Type.SUCCESS
        );
    }

    return (
        <Modal
            {...props}
            size="md"
            title="Planifier un message"
            subtitle={channelLabel(channelId)}
            actions={[
                {
                    text: "Planifier",
                    variant: "primary",
                    disabled: !isContentValid || !isTimeValid,
                    onClick: schedule
                },
                {
                    text: `Messages planifiés (${scheduled.length})`,
                    variant: "secondary",
                    onClick: () => {
                        props.onClose();
                        openListModal();
                    }
                }
            ]}
        >
            <Forms.FormTitle>Message</Forms.FormTitle>
            <TextArea
                value={content}
                onChange={setContent}
                placeholder="Écris ton message ici…"
                rows={4}
                autosize
            />
            <Forms.FormText className={cl("charcount", { "charcount-over": trimmed.length > MAX_CONTENT_LENGTH })}>
                {trimmed.length}/{MAX_CONTENT_LENGTH}
            </Forms.FormText>

            <Forms.FormTitle className={Margins.top16}>Envoyer</Forms.FormTitle>
            <div className={cl("presets")}>
                {TIME_PRESETS.map(([label, getTime]) => (
                    <Button
                        key={label}
                        size={Button.Sizes.SMALL}
                        color={Button.Colors.PRIMARY}
                        onClick={() => setWhen(toLocalInputValue(getTime()))}
                    >
                        {label}
                    </Button>
                ))}
            </div>
            <input
                type="datetime-local"
                className={cl("date-picker")}
                value={when}
                min={toLocalInputValue(Date.now())}
                onChange={e => setWhen(e.currentTarget.value)}
                style={{ colorScheme: getTheme() === Theme.Light ? "light" : "dark" }}
            />

            <Forms.FormText className={cl("preview")}>
                {isTimeValid
                    ? <>Sera envoyé {Parser.parse(`<t:${Math.round(dueAt / 1000)}:F>`)} ({Parser.parse(`<t:${Math.round(dueAt / 1000)}:R>`)})</>
                    : "Choisis une date dans le futur."}
            </Forms.FormText>
        </Modal>
    );
}

function ListModal(props: RenderModalProps) {
    usePendingVersion();

    const sorted = [...scheduled].sort((a, b) => a.dueAt - b.dueAt);

    return (
        <Modal
            {...props}
            size="md"
            title="Messages planifiés"
            actions={[{ text: "Fermer", variant: "secondary", onClick: props.onClose }]}
        >
            {sorted.length === 0
                ? <Text className={cl("empty")} variant="text-md/normal">Aucun message planifié.</Text>
                : sorted.map(msg => (
                    <div key={msg.id} className={cl("item")}>
                        <div className={cl("item-header")}>
                            <Text variant="text-md/semibold">{channelLabel(msg.channelId)}</Text>
                            <Text variant="text-sm/normal" className={cl("item-when")}>
                                {new Date(msg.dueAt).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}
                                {" — "}{Parser.parse(`<t:${Math.round(msg.dueAt / 1000)}:R>`)}
                            </Text>
                        </div>

                        {msg.error && (
                            <Text variant="text-sm/normal" className={cl("item-error")}>
                                Échec d'envoi : {msg.error}
                            </Text>
                        )}
                        {msg.paused && !msg.error && (
                            <Text variant="text-sm/normal" className={cl("item-late")}>
                                En retard (Discord était fermé) — en attente de ta confirmation
                            </Text>
                        )}

                        <Text variant="text-sm/normal" className={cl("item-content")}>
                            {msg.content.length > 300 ? msg.content.slice(0, 300) + "…" : msg.content}
                        </Text>

                        <div className={cl("item-actions")}>
                            <Button size={Button.Sizes.SMALL} onClick={() => sendNow(msg)}>
                                {msg.error ? "Réessayer" : "Envoyer maintenant"}
                            </Button>
                            <Button size={Button.Sizes.SMALL} color={Button.Colors.RED} onClick={() => removeScheduled(msg.id)}>
                                Annuler
                            </Button>
                            <Button
                                size={Button.Sizes.SMALL}
                                color={Button.Colors.PRIMARY}
                                onClick={() => { props.onClose(); jumpToChannel(msg); }}
                            >
                                Voir le salon
                            </Button>
                        </div>
                    </div>
                ))}
        </Modal>
    );
}

function openListModal() {
    openModal(props => <ListModal {...props} />);
}

const SendLaterIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg
        width={width}
        height={height}
        className={className}
        viewBox="0 0 24 24"
        style={{ scale: "1.1" }}
    >
        <path
            fill="currentColor"
            d="M12 2a10 10 0 1 0 10 10A10.011 10.011 0 0 0 12 2Zm0 18a8 8 0 1 1 8-8 8.009 8.009 0 0 1-8 8Zm.5-13H11v6.42l4.9 2.94.77-1.28-4.17-2.5Z"
        />
    </svg>
);

const SendLaterButton: ChatBarButtonFactory = ({ isMainChat, channel }) => {
    usePendingVersion();

    if (!isMainChat) return null;

    const count = scheduled.length;
    const tooltip = count > 0
        ? `Planifier l'envoi — ${count} en attente (clic droit : liste)`
        : "Planifier l'envoi (clic droit : liste)";

    return (
        <ChatBarButton
            tooltip={tooltip}
            onClick={() => openModal(props => <ScheduleModal {...props} channelId={channel.id} />)}
            onContextMenu={e => { e.preventDefault(); openListModal(); }}
            buttonProps={{ "aria-haspopup": "dialog" }}
        >
            <SendLaterIcon />
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "SendLater",
    // Bilingue / Bilingual — visible dans la liste des plugins Vencord
    description: "Schedule messages to send later, while Discord stays open. / Planifie l'envoi de messages en différé, tant que Discord reste ouvert. (bouton horloge + commande /sendlater)",
    authors: [{ name: "Saliox", id: 0n }],
    tags: ["Chat", "Utility"],
    settings,

    chatBarButton: {
        icon: SendLaterIcon,
        render: SendLaterButton
    },

    commands: [{
        name: "sendlater",
        description: "Programmer un message dans ce salon / Schedule a message in this channel",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [
            {
                name: "message",
                description: "Le contenu à envoyer / The content to send",
                type: ApplicationCommandOptionType.STRING,
                required: true
            },
            {
                name: "quand",
                description: "Délai ou heure : 10m, 1h30, 2h, 90s, 1d, ou 20:00 / Delay or time: 10m, 1h30, 20:00…",
                type: ApplicationCommandOptionType.STRING,
                required: true
            }
        ],
        execute: (args, ctx) => {
            const content = findOption<string>(args, "message", "").trim();
            const whenRaw = findOption<string>(args, "quand", "");
            const dueAt = parseWhen(whenRaw);

            if (!content) {
                return sendBotMessage(ctx.channel.id, { content: "❌ Message vide. / Empty message." });
            }
            if (content.length > MAX_CONTENT_LENGTH) {
                return sendBotMessage(ctx.channel.id, {
                    content: `❌ Message trop long (${content.length}/${MAX_CONTENT_LENGTH}). / Message too long.`
                });
            }
            if (dueAt == null) {
                return sendBotMessage(ctx.channel.id, {
                    content: "❌ Heure invalide. Exemples : `10m`, `1h30`, `90s`, `1d`, `20:00`.\n❌ Invalid time. Examples: `10m`, `1h30`, `20:00`."
                });
            }

            addScheduled(ctx.channel.id, content, dueAt);
            sendBotMessage(ctx.channel.id, {
                content: `✅ Message programmé pour <t:${Math.round(dueAt / 1000)}:F> (<t:${Math.round(dueAt / 1000)}:R>).\n✅ Scheduled for <t:${Math.round(dueAt / 1000)}:F>. — /sendlater`
            });
        }
    }],

    settingsAboutComponent: () => (
        <>
            <Forms.FormTitle>🇫🇷 Objectif</Forms.FormTitle>
            <Forms.FormText className={Margins.bottom8}>
                <b>SendLater</b> te permet d'écrire un message maintenant et de le faire partir automatiquement
                plus tard, à l'heure de ton choix. Idéal pour des annonces, des rappels ou pour poster à une heure
                précise sans être devant l'écran.
            </Forms.FormText>
            <Forms.FormText className={Margins.bottom8}>
                <b>Deux façons de l'utiliser :</b><br />
                • Le bouton <b>horloge</b> dans la barre de message (clic = planifier le brouillon, clic droit = liste des messages en attente).<br />
                • La commande <b>/sendlater</b> : <code>message</code> = le texte, <code>quand</code> = <code>10m</code>, <code>1h30</code>, <code>90s</code>, <code>1d</code> ou une heure comme <code>20:00</code>.
            </Forms.FormText>
            <Forms.FormText className={Margins.bottom8}>
                ⚠️ Les messages ne partent que si Discord est <b>ouvert</b> à l'heure prévue (planification côté client, pas serveur).
            </Forms.FormText>

            <Forms.FormTitle className={Margins.top16}>🇬🇧 Purpose</Forms.FormTitle>
            <Forms.FormText className={Margins.bottom8}>
                <b>SendLater</b> lets you write a message now and have it sent automatically later, at the time you
                pick — great for announcements, reminders or posting at a precise time while you're away.
            </Forms.FormText>
            <Forms.FormText className={Margins.bottom8}>
                <b>Two ways to use it:</b><br />
                • The <b>clock</b> button in the chat bar (click = schedule your draft, right-click = pending list).<br />
                • The <b>/sendlater</b> command: <code>message</code> = the text, <code>quand</code> = <code>10m</code>, <code>1h30</code>, <code>90s</code>, <code>1d</code> or a clock time like <code>20:00</code>.
            </Forms.FormText>
            <Forms.FormText className={Margins.bottom8}>
                ⚠️ Messages only fire while Discord is <b>open</b> at the scheduled time (client-side scheduling, not server-side).
            </Forms.FormText>

            <Button onClick={openListModal}>Voir les messages planifiés / View scheduled messages</Button>
        </>
    ),

    async start() {
        scheduled = await DataStore.get<ScheduledMessage[]>(STORAGE_KEY) ?? [];

        const missed = scheduled.filter(m => m.dueAt <= Date.now() && !m.paused && !m.error);
        if (missed.length > 0) {
            const behavior = settings.store.missedBehavior;
            if (behavior === "drop") {
                scheduled = scheduled.filter(m => !missed.includes(m));
                save();
            } else if (behavior === "notify") {
                missed.forEach(m => { m.paused = true; });
                save();
            }
            if (behavior !== "send") {
                // laisse le client finir de démarrer avant de notifier
                setTimeout(() => showNotification({
                    title: "Send Later",
                    body: behavior === "drop"
                        ? `${missed.length} message(s) planifié(s) abandonné(s) (heure dépassée pendant que Discord était fermé).`
                        : `${missed.length} message(s) planifié(s) ont dépassé leur heure pendant que Discord était fermé. Clique pour les gérer.`,
                    onClick: behavior === "drop" ? undefined : openListModal
                }), 5000);
            }
        }

        sweepTimer = window.setInterval(sweep, SWEEP_INTERVAL);
    },

    stop() {
        if (sweepTimer) window.clearInterval(sweepTimer);
        sweepTimer = undefined;
    }
});
