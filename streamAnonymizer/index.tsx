/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { definePluginSettings } from "@api/Settings";
import { Margins } from "@utils/margins";
import definePlugin, { IconComponent, OptionType } from "@utils/types";
import { Forms, RelationshipStore, showToast, StreamerModeStore, Toasts, UserStore, useStateFromStores } from "@webpack/common";

const settings = definePluginSettings({
    hideSelf: {
        type: OptionType.BOOLEAN,
        description: "Masquer mon propre pseudo / Hide my own name",
        default: true
    },
    hideFriends: {
        type: OptionType.BOOLEAN,
        description: "Masquer le pseudo de mes amis / Hide my friends' names",
        default: true
    },
    hideEveryone: {
        type: OptionType.BOOLEAN,
        description: "Bonus : masquer TOUS les pseudos (anonymat total) / Bonus: hide EVERYONE's name (full anonymity)",
        default: false
    },
    selfName: {
        type: OptionType.STRING,
        description: "Nom affiché à ta place / Name shown instead of yours",
        default: "Streamer"
    },
    friendPrefix: {
        type: OptionType.STRING,
        description: "Préfixe des alias d'amis (un code stable est ajouté) / Friend alias prefix (a stable code is appended)",
        default: "Ami"
    },
    autoWithStreamerMode: {
        type: OptionType.BOOLEAN,
        description: "S'activer automatiquement quand le Mode Streamer de Discord est actif / Auto-enable when Discord Streamer Mode is on",
        default: true
    },
    active: {
        type: OptionType.BOOLEAN,
        description: "Masquage actif (basculé par le bouton)",
        default: false,
        hidden: true
    }
});

function isMaskingActive() {
    if (settings.store.active) return true;
    try {
        return settings.store.autoWithStreamerMode && StreamerModeStore.enabled;
    } catch {
        return false;
    }
}

// alias stable et déterministe dérivé de l'id : le streamer reconnaît qui
// est qui, mais l'id/pseudo réel ne fuite jamais à l'écran.
// Mémoïsé : mask() est appelé pour CHAQUE nom rendu (messages, membres,
// mentions…), inutile de recalculer le hash à chaque fois.
const aliasCache = new Map<string, string>();
const ALIAS_CACHE_MAX = 5000;

function alias(id: string, prefix: string) {
    const p = prefix || "Ami";
    const key = p + ":" + id;
    const cached = aliasCache.get(key);
    if (cached !== undefined) return cached;

    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
    const code = Math.abs(hash).toString(36).toUpperCase().padStart(4, "0").slice(0, 4);
    const result = `${p}-${code}`;
    // borne mémoire : les alias sont déterministes, vider = sans effet visible
    if (aliasCache.size >= ALIAS_CACHE_MAX) aliasCache.clear();
    aliasCache.set(key, result);
    return result;
}

const MaskIcon: IconComponent = ({ height = 20, width = 20, className }) => {
    settings.use(["active"]); // re-render au basculement du bouton
    // s'abonne AUSSI au Mode Streamer natif : sinon l'icône reste figée quand
    // l'utilisateur (dés)active le Mode Streamer de Discord alors que le
    // masquage auto est en jeu. On dérive l'état de isMaskingActive().
    const active = useStateFromStores([StreamerModeStore], () => isMaskingActive());
    return (
        <svg
            width={width}
            height={height}
            className={className}
            viewBox="0 0 24 24"
            style={{ scale: "1.1", color: active ? "var(--status-danger)" : "currentcolor" }}
        >
            <path
                fill="currentColor"
                d="M20.5 6c-2.6 0-4.9.8-6.5 2.1H10C8.4 6.8 6.1 6 3.5 6 2.7 6 2 6.7 2 7.5v4C2 14 4 16 6.5 16c2.2 0 4-1.5 4.4-3.5.2-.9 1-1.5 1.1-1.5s.9.6 1.1 1.5c.4 2 2.2 3.5 4.4 3.5 2.5 0 4.5-2 4.5-4.5v-4c0-.8-.7-1.5-1.5-1.5ZM6.5 14C5.1 14 4 12.9 4 11.5S5.1 9 6.5 9 9 10.1 9 11.5 7.9 14 6.5 14Zm11 0c-1.4 0-2.5-1.1-2.5-2.5S16.1 9 17.5 9 20 10.1 20 11.5 18.9 14 17.5 14Z"
            />
        </svg>
    );
};

const MaskButton: ChatBarButtonFactory = ({ isMainChat }) => {
    const { active: enabled } = settings.use(["active"]);
    // abonnement au Mode Streamer natif AVANT tout return (règle des hooks) :
    // maintient l'infobulle à jour quand le Mode Streamer change.
    const masking = useStateFromStores([StreamerModeStore], () => isMaskingActive());

    if (!isMainChat) return null;

    const auto = !enabled && masking;

    return (
        <ChatBarButton
            tooltip={enabled
                ? "Anonymat stream ACTIF — clic pour désactiver"
                : auto
                    ? "Anonymat auto (Mode Streamer) — clic pour forcer/désactiver"
                    : "Anonymat stream : cacher ton pseudo et celui de tes amis"}
            onClick={() => {
                settings.store.active = !settings.store.active;
                showToast(
                    settings.store.active
                        ? "Anonymat stream activé — bascule de salon pour rafraîchir les pseudos affichés"
                        : "Anonymat stream désactivé",
                    Toasts.Type.SUCCESS
                );
            }}
        >
            <MaskIcon />
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "StreamAnonymizer",
    // Bilingue / Bilingual
    description: "Hide your username AND your friends' usernames while streaming. / Cache ton pseudo ET celui de tes amis pendant un stream.",
    authors: [{ name: "Saliox", id: 0n }],
    tags: ["Privacy", "Appearance", "Voice"],
    settings,

    patches: [
        {
            // fonction centrale de résolution des noms (getName/useName) :
            // couvre liste des membres, messages, mentions, DM, vocal, popouts
            find: "getNickname:",
            replacement: {
                match: /(?<=\{getNickname:\i,)getName:(\i),useName:(\i)(?=\})/,
                replace: "getName:(...a)=>$self.mask($1(...a),a[2]),useName:(...a)=>$self.mask($2(...a),a[2])"
            }
        }
    ],

    chatBarButton: {
        icon: MaskIcon,
        render: MaskButton
    },

    // appelée par le patch avec le nom résolu + l'objet utilisateur.
    // Chemin CHAUD (chaque nom rendu) : on sort au plus vite et on lit
    // settings.store une seule fois.
    mask(name: string, user: any) {
        try {
            if (!isMaskingActive()) return name;
            if (!user || typeof user !== "object" || !user.id) return name;

            const id: string = user.id;
            const s = settings.store;

            if (s.hideSelf && id === UserStore.getCurrentUser()?.id) {
                return s.selfName || "Streamer";
            }

            if (s.hideFriends && RelationshipStore.isFriend(id)) {
                return alias(id, s.friendPrefix);
            }

            if (s.hideEveryone) {
                return alias(id, "User");
            }

            return name;
        } catch {
            return name;
        }
    },

    settingsAboutComponent: () => (
        <>
            <Forms.FormTitle>🇫🇷 Objectif</Forms.FormTitle>
            <Forms.FormText className={Margins.bottom8}>
                <b>StreamAnonymizer</b> est pensé pour le <b>streaming</b> : il ne cache pas seulement ton propre
                pseudo, mais aussi celui de <b>tes amis</b>, partout où Discord affiche un nom (liste des membres,
                messages, mentions, salons vocaux, MP…). Tes amis reçoivent un alias stable (ex.&nbsp;
                <code>Ami-3F2A</code>) : tu sais qui est qui, mais leur identité réelle n'apparaît jamais à l'écran.
            </Forms.FormText>
            <Forms.FormText className={Margins.bottom8}>
                Active-le via le <b>bouton masque</b> dans la barre de message, ou laisse l'option <i>Mode Streamer</i>
                l'activer automatiquement quand tu lances le Mode Streamer de Discord.
            </Forms.FormText>
            <Forms.FormText className={Margins.bottom8}>
                ⚠️ Après activation, <b>change de salon</b> (ou fais défiler) pour que les pseudos déjà affichés se
                rafraîchissent. Le masquage ne modifie que l'affichage : rien n'est envoyé à Discord.
            </Forms.FormText>

            <Forms.FormTitle className={Margins.top16}>🇬🇧 Purpose</Forms.FormTitle>
            <Forms.FormText className={Margins.bottom8}>
                <b>StreamAnonymizer</b> is made for <b>streaming</b>: it hides not only your own username but also
                your <b>friends'</b> usernames, everywhere Discord shows a name (member list, messages, mentions,
                voice channels, DMs…). Friends get a stable alias (e.g. <code>Ami-3F2A</code>) so you can still tell
                them apart, while their real identity never appears on screen.
            </Forms.FormText>
            <Forms.FormText className={Margins.bottom8}>
                Toggle it with the <b>mask</b> button in the chat bar, or let the <i>Streamer Mode</i> option enable
                it automatically when you turn on Discord's Streamer Mode.
            </Forms.FormText>
            <Forms.FormText>
                ⚠️ After enabling, <b>switch channels</b> (or scroll) so already-rendered names refresh. Masking only
                affects display — nothing is sent to Discord.
            </Forms.FormText>
        </>
    )
});
