# Set it up from your iPhone (no laptop)

Everything here is done in Safari on your iPhone. It takes about 30–45 minutes, most of it waiting.
**Never paste passwords, codes or keys into a chat with anyone, AI bots included.** You only type them into the Oracle website, the control page, or the WhatsApp/Telegram/Beeper apps.

You need:
- your iPhone with the **Beeper** app signed in (for the emoji check);
- a bank card (Oracle uses it to check you're a real person; Always Free resources cost $0);
- an email address for Oracle.

---

## 1. Create a free Oracle Cloud account

1. Open **https://signup.cloud.oracle.com** in Safari.
2. Fill in your country, name and email, then verify your email.
3. **Home region**: pick the one closest to you. It can't be changed later. Busy regions sometimes run out of free ARM servers; if that happens, see Problems below.
4. Add the card for verification. Choose the **Free Tier / Always Free** account (don't upgrade to Pay As You Go).
5. Wait for the "Your account is ready" email, then sign in at **https://cloud.oracle.com**.

## 2. Choose your access key

Make up a long private phrase of **12 characters or more**, for example `purple-lagos-river-2026-zebra`. Save it in your iPhone Passwords app or Notes. It's the password for your control page and the key the server uses to encrypt its address.

## 3. Create the server (VM) and paste the setup script

1. In the Oracle console, tap the menu (☰) → **Compute** → **Instances** → **Create instance**.
2. **Name**: `beeper-autoreply`.
3. **Image and shape** → **Edit**:
   - **Image**: *Change image* → **Canonical Ubuntu** → **24.04** (22.04 also works) → *Select image*.
   - **Shape**: *Change shape* → **Ampere** → **VM.Standard.A1.Flex**, **2 OCPUs** and **12 GB memory**. It's marked "Always Free-eligible". → *Select shape*.
4. **Networking**: keep the defaults. *Create new virtual cloud network* and *Assign a public IPv4 address* must be on, so the server can reach the internet.
5. **Add SSH keys**: choose **Generate a key pair for me** and tap *Save private key* (it goes to Files). You probably won't need it, but keep it.
6. Scroll down → **Show advanced options** → **Management** tab → **Initialization script** → **Paste cloud-init script**.
7. In a new Safari tab open
   **https://raw.githubusercontent.com/Bobbykelvin11/beeper-autoreply/main/setup/cloud-init.sh**
   then long-press the text → **Select All** → **Copy**.
8. Go back to the Oracle tab and paste it into the box. Near the top, **edit this line**:
   ```
   CONTROL_SECRET="CHANGE-ME-to-a-long-private-phrase"
   ```
   Replace the text between the quotes with your access key from step 2. Leave everything else as is:
   - `INSTALL_OLLAMA="yes"` gives you a free open-source AI on the server;
   - `TUNNEL="cloudflare"` needs no account.
9. Tap **Create**. Wait until the instance says **Running**, then give it **10–15 more minutes** to install everything. The AI model keeps downloading in the background for a few more minutes.

## 4. Open the control page

1. Open the control page link you were given (your Vercel address, for example `https://beeper-autoreply-xxxx.vercel.app`).
2. Tap **Share** → **Add to Home Screen**. From now on, open it from the **Auto-Reply** icon.
3. Type your **access key** and tap **Sign in**. The page finds your server automatically. If it says it can't find the server, wait 2 minutes and try again.

## 5. Link your Beeper account (Link tab)

1. **Beeper account** → type your Beeper email → **Send code**.
2. Open the email from Beeper, then type the code into the page → **Sign in**.
3. Tap **Start verification**. Your Beeper iPhone app asks you to verify a new login: tap **Accept**.
4. Emoji appear on both screens. If they're the same, tap **They match** on the page and confirm in the Beeper app.
   - No prompt in the Beeper app? Tap **Use my recovery code instead** and type your Beeper recovery code.
5. The card shows **linked** when it's done.

## 6. Connect WhatsApp and Telegram on the server (Link tab → Chat apps)

Your server is a new "device", so connect each app there once. Use the ones marked **on this server**.

**WhatsApp (pairing code, no second phone needed)**
1. Tap **Connect** next to WhatsApp. If it asks *how to sign in*, choose the **phone number / pairing code** option.
2. Type your WhatsApp number with country code (e.g. `+234…`). The page shows an **8-character code**.
3. Open WhatsApp on your iPhone → **Settings** → **Linked Devices** → **Link a Device** → **Link with phone number instead**, and type the code.
4. The page says **Connected!** WhatsApp lets you link up to 4 devices, so this uses one slot.
   - If WhatsApp only offers a **QR code**, you can't scan your own screen. Open the control page on another screen (a friend's phone, a computer or a tablet) and scan that QR with your iPhone's WhatsApp → Linked Devices.

**Telegram**
1. Tap **Connect** next to Telegram and type your phone number with country code.
2. Telegram sends a login code inside the Telegram app. Type it into the page.
3. If you have a Telegram cloud password (2-step verification), the page asks for it next.

Other apps (Instagram, Messenger, Discord, LinkedIn…) sign in with browser cookies. That's hard on an iPhone, so start with WhatsApp and Telegram.

## 7. Choose chats and modes (Chats tab)

- Turn on the switch for each chat the bot may answer. **Nothing is answered until you allow it.**
- Under each allowed chat, pick **Default**, **Approve** or **Automatic**. *Default* follows the setting on the Home tab.
- Tap a chat's name to add instructions, e.g. "This is my mom. Be sweet, reply in Yoruba."

## 8. Settings

- **Your voice**: describe how you talk (persona and style).
- **AI provider**: *Ollama on this server* works with no key. For faster replies, tap **Groq**, create a free key at https://console.groq.com/keys, paste the key **into the Settings page** (never into a chat) and save. Tap **Test with a sample message**.
- **Quiet hours**, delays and limits: the defaults are safe. Keep the limits low; WhatsApp bans spammy automation.

## 9. Turn it on (Home tab)

- Turn on **Auto-reply bot**. **Default mode** starts as **Approve**.
- New drafts show up in the **Approve** tab and in your Beeper **Note to self** chat. Reply there with:
  - `ok ab12` sends the draft;
  - `no ab12` rejects it;
  - `edit ab12 your new text` sends your edited version;
  - `drafts` lists what's waiting;
  - `bot off` / `bot on` turns everything off or on.
- If you reply to someone yourself, the bot drops its draft for that chat.

---

## Problems

| Problem | Fix |
| --- | --- |
| Oracle says **Out of capacity** for A1 | Try another *Availability domain* in the Placement section, try 1 OCPU / 6 GB, or try again later. Last resort: shape **VM.Standard.E2.1.Micro** (AMD, 1 GB) with `INSTALL_OLLAMA="no"` and Groq as the AI. |
| Control page: "Couldn't find your server" | Wait 2–5 minutes after the VM starts. Check that the access key is exactly the one in the script. Make sure the instance is *Running*. |
| Control page: "Wrong access key" 5 times | The server blocks guesses for 10 minutes. Wait and retry. |
| The script failed | In Oracle: instance → **Console connection** → *Launch Cloud Shell connection*, sign in as `ubuntu` with your SSH key, then run `sudo tail -50 /var/log/beeper-autoreply-setup.log`. |
| Bot not replying | Check the Home tab: Beeper *signed in*, Live messages *connected*, at least 1 allowed chat, bot *On*. The Activity tab shows the reason for each skip. |
| Oracle stopped the VM ("idle") | Oracle can stop free VMs that sit almost idle for a week. Start it again from Instances. Everything is saved. |

Updates install automatically once a week.
