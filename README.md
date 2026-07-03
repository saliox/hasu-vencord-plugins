# Hasu Vencord Plugins

Trois userplugins pour [Vencord](https://github.com/Vendicated/Vencord), par **Saliox**.
*Three Vencord userplugins — English summary below.*

| Plugin | Description |
| --- | --- |
| ⏰ **SendLater** | Planifie l'envoi de messages : écris, choisis l'heure, le message part tout seul tant que Discord est ouvert. Persistance des messages planifiés, gestion des envois « ratés » hors-ligne. |
| 🎧 **FakeDeafen** | Apparais casque/micro coupé aux yeux des autres tout en continuant de parler. Option pour couper *réellement* ton casque (tu n'entends plus rien, mais ton micro émet toujours). |
| 📉 **DataSaver** | Réduit la consommation internet de Discord (embeds, images inline, GIFs, animations) avec **mode auto quand un jeu tourne**, et un panneau d'analyse de connexion (ping API/vocal, Wi-Fi/Ethernet) **sans collecter ni stocker d'IP**. |

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

pnpm build
pnpm inject   # une seule fois, pour brancher Discord sur votre build
```

Puis, dans Discord : **Paramètres → Vencord → Plugins** → activer les plugins.

## Utilisation

- **SendLater** : icône horloge dans la barre de message. Clic = planifier le brouillon en cours (presets +10 min, +1 h, ce soir, demain). Clic droit = liste des messages en attente (envoyer maintenant / annuler).
- **FakeDeafen** : icône casque dans la barre de message. Clic = basculer. Rouge = actif. Réglages : apparence (deaf/mute) et coupure réelle du son.
- **DataSaver** : icône jauge. Clic = mode éco. Clic droit = état de la connexion. Le mode auto s'active/se coupe tout seul avec vos jeux (détection Discord native). Les réglages Discord modifiés sont **sauvegardés puis restaurés à l'identique**.

## Notes

- FakeDeafen : à utiliser de façon responsable — les autres ne savent pas que vous entendez/parlez encore.
- DataSaver : le choix Wi-Fi/Ethernet pour Discord seul relève du système d'exploitation, pas d'un plugin ; le panneau affiche l'interface utilisée quand le système l'expose.
- Vencord est une modification client non officielle ; son usage est à vos risques vis-à-vis des conditions de Discord.

## English summary

- **SendLater** — schedule messages from the chat bar (clock icon); pending messages persist across restarts and only send while Discord is open.
- **FakeDeafen** — appear deafened/muted while still transmitting your mic; optional *real* output mute so you truly hear nothing.
- **DataSaver** — low-data mode (embeds, inline media, GIFs, animations) with auto-enable while a game is running, plus a connection panel (API/voice ping, network type) that never collects or stores IPs.

Install: copy each folder into `Vencord/src/userplugins/`, then `pnpm build` and enable in settings.

## Licence

[GPL-3.0](LICENSE) — même licence que Vencord.
