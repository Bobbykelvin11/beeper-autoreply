# Set up Beeper Auto-Reply from your iPhone (everything on one free Oracle VM)

You need: an iPhone with Safari, a credit/debit card for Oracle's identity check (the Always Free VM costs nothing), and about 45 minutes. No laptop.

At the end you have a web app on your Home Screen. It runs on your own VM with a free HTTPS address, links to your WhatsApp, Telegram and other chats, and drafts or sends AI replies.

## 1. Oracle account

1. Open **cloud.oracle.com** in Safari.
2. **Already have an account?** Tap **Sign in**, enter your *Cloud Account Name* (your tenancy name), then your username and password. Skip to step 2.
3. **New?** Tap **Sign up** or **Try for free**, then fill in email, name and country. Verify the email, then choose a **home region**: pick one close to you. You can't change it later.
4. Enter the card for verification (a small temporary hold, later reversed) and your phone number for the code. Activation takes anywhere from a few minutes to a few hours, and Oracle emails you when it's ready.

## 2. Create the VM

1. In the Oracle console tap **☰** (top left), then **Compute**, then **Instances**, then **Create instance**.
2. **Name:** `beeper-bot`.
3. **Image and shape:** tap **Edit**, then **Change image**, then choose **Canonical Ubuntu 24.04** (22.04 is fine too). Tap **Change shape**, choose **Ampere**, tick **VM.Standard.A1.Flex**, and set **2 OCPUs and 12 GB memory** (free allowance: up to 4 OCPUs and 24 GB in total).
   - If you see **"Out of capacity"**, wait a few hours and try again, or try another *Availability domain* under Placement. Free ARM servers are popular.
   - Fallback: **AMD VM.Standard.E2.1.Micro** (1 GB memory). It works, but it's slow, and the first install can take 30+ minutes. The free local AI (Ollama) won't fit, so you'll use a free Groq key instead.
4. **Networking:** leave the defaults (a new virtual cloud network and public subnet) and make sure **Automatically assign public IPv4 address** is on.
5. **SSH keys:** choose **No SSH keys** (you won't need them).
6. **Boot volume:** the default is fine.
7. Tap **Show advanced options**, then the **Management** tab, find **Cloud-init script** and choose **Paste cloud-init script**. Paste these three lines. **Change `CHANGE-ME-to-your-own-key` to your own access key first**, using 12 or more letters, numbers, `-` or `_` and no spaces. This key is your sign-in password for the app; remember it.

```
#!/bin/bash
export CONTROL_SECRET=CHANGE-ME-to-your-own-key
curl -fsSL https://raw.githubusercontent.com/Bobbykelvin11/beeper-autoreply/main/setup/oracle-bootstrap.sh | bash
```

8. Tap **Create**. Wait until the instance status says **Running** (about 2 minutes). The installer then keeps working on the VM for roughly 10 to 25 minutes.

The installer generates a random session key on the VM. You never see it and it isn't stored anywhere else.

## 3. Open ports 80 and 443

Without this the page won't load. Oracle blocks all web traffic until you allow it.

1. On the instance page, scroll to **Instance information** (or tap the **Networking** tab), then tap the **Subnet** link (named like `subnet-2026…`).
2. Tap the **Security** tab, then tap **Default Security List for vcn-…**.
3. Tap **Security rules**, then **Add Ingress Rules**.
4. Enter **Source CIDR** `0.0.0.0/0`, **IP Protocol** `TCP`, and **Destination Port Range** `443`. Tap **+ Another Ingress Rule** and add the same with `80`. Tap **Add Ingress Rules**.

## 4. Find the address and open the app

1. On the instance page, copy the **Public IP address**, for example `129.146.10.20`.
2. Replace the dots with dashes and add `.sslip.io`: **`https://129-146-10-20.sslip.io`**.
3. Open it in Safari. If it says it can't connect, the installer is still running. Wait 5 minutes and refresh; the first install can take up to 25 minutes (30+ on the AMD micro). The certificate is issued automatically when the page first comes up.
4. Sign in with your access key. Then tap **Share**, then **Add to Home Screen**, to install the app.

## 5. Link your Beeper account

In the app, open the **Link** tab.

1. Enter the email of your Beeper account. Beeper emails you a code; type it in. (Don't have a Beeper account? Create one free in the Beeper app first.)
2. Beeper asks you to verify the new "device". Open the Beeper app on your iPhone and accept the verification request, comparing the emoji, or use your recovery code instead if the app offers it.

## 6. Connect your chat apps

Still in the **Link** tab, under **Connect chat apps**:

- **WhatsApp:** tap WhatsApp. The app shows a **QR code**, and WhatsApp needs a *different* device's camera to scan it.
  - Open your app page on a second screen (another phone, tablet or computer), show the QR there, then on your iPhone tap **WhatsApp → Settings → Linked devices → Link a device** and scan it. This is the part of setup that needs a second screen.
  - If the app offers a **phone number / pairing code** option, choose that instead. Then on your iPhone tap **Link a device → Link with phone number instead** and type in the code.
- **Telegram:** enter your phone number, then the code Telegram sends you in the Telegram app (and your two-step password if you set one).
- **Instagram, Messenger, Signal, Discord, others:** tap the app and follow the prompts. Some use a username and password, and some use a QR. Meta apps (Instagram and Messenger) are more likely to block automation, so use them with care.

Chats from apps you set up *on your iPhone's Beeper app* won't appear here. Connect each app again on the server like this.

## 7. Turn the bot on

1. **Settings:** choose your AI. On an ARM VM with 8 GB+ memory, the free built-in AI (Ollama, `qwen2.5:3b`) is already selected; it's downloaded about 5 minutes after install, and replies are slow but private. For better replies, paste a free **Groq** key (console.groq.com/keys) with base URL `https://api.groq.com/openai/v1`. Set your persona and style.
2. **Chats:** tap refresh, then switch on only the chats you want it to answer. Each chat can be **Approve before send** (default) or **Fully automatic**.
3. **Home:** switch the master toggle **On**.
4. **Drafts:** with approve mode, tap **Send**, **Edit** or **Reject**. You can also answer in your Beeper **Note to self** chat: `ok ab12`, `no ab12`, `edit ab12 new text`.

## Good to know

- **Account risk:** WhatsApp, Instagram and Messenger ban automated messaging. Keep auto mode to a few trusted chats, with delays and rate limits on. Approve mode is the safest.
- **Weekly updates:** the VM updates itself from this repo every week.
- **Oracle Always Free** servers can be reclaimed if they sit idle for a long time. This one is busy, but sign in to Oracle now and then.
- **Don't want sslip.io?** If a certificate error appears (the shared sslip.io name can hit certificate limits), create a free name at **duckdns.org**, then recreate the VM with these extra lines before the `curl` line:

```
export DUCKDNS_SUBDOMAIN=yourname
export DUCKDNS_TOKEN=your-duckdns-token
```

  and use `https://yourname.duckdns.org`.
- **Page doesn't load?** Check, in order: the 80 and 443 ingress rules (step 3), that you used `https://`, that you replaced dots with dashes, and that 25 minutes have passed.
