# Hasu Vencord Plugins

Cinq userplugins pour [Vencord](https://github.com/Vendicated/Vencord), par **Saliox**.
*Five Vencord userplugins — English summary below.*

| Plugin | Description |
| --- | --- |
| ⏰ **SendLater** | Planifie l'envoi de messages : écris, choisis l'heure, le message part tout seul tant que Discord est ouvert. Bouton horloge **+ commande `/sendlater`**. Persistance des messages planifiés, gestion des envois « ratés » hors-ligne. |
| 🎧 **FakeDeafen** | Apparais casque/micro coupé aux yeux des autres tout en continuant de parler. Bouton dans le **panneau vocal** (à côté du micro). Option pour couper *réellement* ton casque. |
| 📉 **DataSaver** | Réduit la consommation internet de Discord (embeds, images inline, GIFs, animations) avec **mode auto quand un jeu tourne**, et un panneau d'analyse de connexion (ping API/vocal, Wi-Fi/Ethernet) **sans collecter ni stocker d'IP**. |
| 🎭 **StreamAnonymizer** | Pour le **streaming** : cache **ton pseudo ET celui de tes amis** partout (liste des membres, messages, mentions, vocal, MP). Alias stable par ami pour t'y retrouver. Auto avec le Mode Streamer de Discord. |
| 🎚️ **HasuControlBar** | **Barre des tâches flottante** (déplaçable) pour activer/couper les plugins ci-dessus d'un clic, **+ raccourcis clavier personnalisables** par bascule. |

## Installation

Les userplugins doivent être compilés dans Vencord (pas d'installation « drag & drop ») :

```bash
git clone https://github.com/Vendicated/Vencord
cd Vencord
pnpm install --frozen-lockfile

# copier les dossiers de plugins dans src/userplugins/
#   Vencord/src/userplugins/sendLater/
#   Vencord/src/userplugins/fakeDeafen/
#   Vencord/src/userplugins/dataSaver/
#   Vencord/src/userplugins/streamAnonymizer/
#   Vencord/src/userplugins/hasuControlBar/

pnpm build
pnpm inject   # une seule fois, pour brancher Discord sur votre build
```

Puis, dans Discord : **Paramètres → Vencord → Plugins** → activer les plugins.

## Utilisation

- **SendLater** :
  - Bouton horloge dans la barre de message : clic = planifier le brouillon (presets +10 min, +1 h, ce soir, demain), clic droit = liste des messages en attente (envoyer maintenant / annuler).
  - Commande **`/sendlater`** : `message` = le texte, `quand` = un délai (`10m`, `1h30`, `90s`, `1d`) ou une heure (`20:00`).
- **FakeDeafen** : icône casque. Clic = basculer. Rouge = actif. Réglages : apparence (deaf/mute) et coupure réelle du son.
- **DataSaver** : icône jauge. Clic = mode éco. Clic droit = état de la connexion. Le mode auto s'active/se coupe tout seul avec vos jeux. Les réglages Discord modifiés sont **sauvegardés puis restaurés à l'identique**.
- **StreamAnonymizer** : icône masque. Clic = activer/désactiver. Ou laisse-le suivre le **Mode Streamer** de Discord. Après activation, change de salon pour rafraîchir les pseudos déjà affichés.
- **HasuControlBar** : une petite barre flottante apparaît à l'écran (attrape la poignée du haut pour la déplacer). Chaque bouton allume/éteint le plugin correspondant. Dans les réglages du plugin, tu peux définir un **raccourci clavier** par bascule (ex. `Ctrl+Alt+D`) ; un modificateur (Ctrl/Alt/Cmd) est requis. Seuls les plugins activés apparaissent.

## Notes

- FakeDeafen : à utiliser de façon responsable — les autres ne savent pas que vous entendez/parlez encore.
- DataSaver : le choix Wi-Fi/Ethernet pour Discord seul relève du système d'exploitation, pas d'un plugin ; le panneau affiche l'interface utilisée quand le système l'expose.
- StreamAnonymizer : le masquage est purement visuel (rien n'est envoyé à Discord) ; il couvre les surfaces qui passent par la résolution de noms de Discord.
- Vencord est une modification client non officielle ; son usage est à vos risques vis-à-vis des conditions de Discord.

## English summary

- **SendLater** — schedule messages from the chat bar (clock icon) **or the `/sendlater` command** (`message` + `quand` = `10m`, `1h30`, `20:00`…); pending messages persist across restarts and only send while Discord is open.
- **FakeDeafen** — appear deafened/muted while still transmitting your mic; optional *real* output mute so you truly hear nothing.
- **DataSaver** — low-data mode (embeds, inline media, GIFs, animations) with auto-enable while a game is running, plus a connection panel (API/voice ping, network type) that never collects or stores IPs.
- **StreamAnonymizer** — for streaming: hides your own **and your friends'** usernames everywhere, with a stable per-friend alias; can follow Discord's Streamer Mode automatically.
- **HasuControlBar** — a draggable floating taskbar to toggle the plugins above in one click, plus a customizable keyboard shortcut per toggle (set in the plugin settings, e.g. `Ctrl+Alt+D`).

Install: copy each folder into `Vencord/src/userplugins/`, then `pnpm build` and enable in settings.

## Licence

[GPL-3.0](LICENSE) — même licence que Vencord.
