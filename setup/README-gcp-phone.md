# Set up Beeper Auto-Reply from your iPhone (Google Cloud Always Free e2-micro)

This is the **recommended** path. You need: an iPhone with Safari, a credit or debit card for Google's identity check (the Always Free e2-micro itself costs nothing if you stay in the free limits), and about an hour. No laptop.

If the Google Cloud console looks cramped in Safari, tap **aA** (or **Share**) and turn on **Request Desktop Website**.

At the end you have a web app on your Home Screen. It runs on your own VM with a free HTTPS address, links to your WhatsApp, Telegram and other chats, and drafts or sends AI replies.

## 1. Google Cloud account (free trial, Individual)

1. Open **console.cloud.google.com** in Safari.
2. **Already have a Google Cloud account?** Sign in with your Google account and skip to step 2.
3. **New?** Sign in with a personal Google account (an Individual account, not a company organization). When Google offers the **free trial**, accept it.
4. Google will ask for a credit or debit card to verify you are a real person. That is normal. **Usage that stays inside the Always Free limits is not charged**, even during the trial. Watch for any paid extras (a second VM, an SSD disk, or a region that is not free).
5. If Google asks you to create a project, name it `beeper-bot` and create it. If Compute Engine asks you to **Enable** the API, tap Enable and wait a minute.

After the 90-day trial, Google may ask you to upgrade to a paid billing account so the VM can keep running. The e2-micro in the free regions still costs $0 if you follow the "staying free" notes below. Set a **$1 budget alert** (step 4) so you get an email before any surprise charge.

## 2. Create the VM

1. In the console, open the **☰** menu, tap **Compute Engine**, then **VM instances**. If it asks to enable the API, do that and wait until the VM list appears.
2. Tap **Create instance** (or **Create**).
3. **Name:** `beeper-bot`.
4. **Region:** `us-east1` (South Carolina — closest to Rhode Island). The Always Free e2-micro is only free in `us-east1`, `us-west1` or `us-central1`. Pick any zone in that region, for example `us-east1-b`.
5. **Machine configuration:** Series **E2**, machine type **e2-micro** (2 vCPU shared, 1 GB memory). Do not pick a larger type; those are billed.
6. **Boot disk:** tap **Change**.
   - Operating system: **Debian** 12 (Bookworm). Ubuntu 22.04 or 24.04 also works.
   - Boot disk type: **Standard persistent disk** — not Balanced, not SSD. Only the standard disk is free.
   - Size: **30 GB**.
   - Tap **Select**.
7. **Firewall:** tick **Allow HTTP traffic** and **Allow HTTPS traffic**. This adds the `http-server` and `https-server` network tags Google needs to open ports 80 and 443. If you skip these checkboxes, the app page will not load.
8. Scroll to **Advanced options**, then **Management**.
   - Under **Metadata**, tap **Add item**. Set **Key** to `control-secret` and **Value** to your own access key: 12 or more letters, numbers, `-` or `_`, and no spaces or quotes. This key is your sign-in password for the app; remember it. It is stored as VM metadata, not in the public repo.
   - Under **Automation**, paste this one line as the **Startup script** (do not put your password in this line):

```
curl -fsSL https://raw.githubusercontent.com/Bobbykelvin11/beeper-autoreply/main/setup/gcp-bootstrap.sh | bash
```

9. Tap **Create**. Wait until the instance status says **Running**. The installer then keeps working on the VM for roughly 20 to 40 minutes the first time (this machine has only 1 GB of memory, so the first build is slow). Later reboots are much faster; the startup script is safe to run every boot.

The installer generates a random session key on the VM. You never see it and it isn't stored anywhere else.

## 3. Find the address and open the app

1. On the VM instance page, copy the **External IP**, for example `34.23.10.20`.
2. Replace the dots with dashes and add `.sslip.io`: **`https://34-23-10-20.sslip.io`**.
3. Open it in Safari. If it says it can't connect, the installer is still running. Wait 5 minutes and refresh; the first install can take up to 40 minutes. The HTTPS certificate is issued automatically when the page first comes up.
4. Sign in with the access key you put in `control-secret`. Then tap **Share**, then **Add to Home Screen**, to install the app.

## 4. Staying on the Always Free tier

- Keep **one** e2-micro only, in **us-east1**, **us-west1** or **us-central1**.
- Keep the boot disk as **30 GB Standard persistent disk** (not Balanced, not SSD).
- Leave the VM running. If you stop and start it, the External IP can change, and your app address becomes a new `https://<new-ip-with-dashes>.sslip.io`.
- The free allowance includes about **1 GB of egress** per month to North America. Browsing the control page and sending chat text is small; lots of photos or video through the bridges can use it up.
- Optional but recommended: in the console open **Billing**, then **Budgets & alerts**, and create a budget of **$1** with email alerts. You get a message if anything starts to cost money.

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

1. **Settings:** this 1 GB VM cannot run a local AI (Ollama). Get a free **Groq** key at [console.groq.com/keys](https://console.groq.com/keys), paste it in the API key field, and leave the Groq preset selected (base URL `https://api.groq.com/openai/v1`). Set your persona and style. Use **Test with a sample message** to confirm it works.
2. **Chats:** tap refresh, then switch on only the chats you want it to answer. Each chat can be **Approve before send** (default) or **Fully automatic**.
3. **Home:** switch the master toggle **On**.
4. **Drafts:** with approve mode, tap **Send**, **Edit** or **Reject**. You can also answer in your Beeper **Note to self** chat: `ok ab12`, `no ab12`, `edit ab12 new text`.

## Good to know

- **Account risk:** WhatsApp, Instagram and Messenger ban automated messaging. Keep auto mode to a few trusted chats, with delays and rate limits on. Approve mode is the safest.
- **Weekly updates:** the VM updates itself from this repo every week.
- **This VM is tight on memory** (1 GB plus a 2 GB swap file). The first install is slow, and the machine may feel sluggish. Leave it running; don't add a second VM.
- **Don't want sslip.io?** If a certificate error appears (the shared sslip.io name can hit certificate limits), create a free name at **duckdns.org**, then set these in the VM's custom metadata (or recreate the VM) and reboot, or SSH in and export them before rerunning the script:

```
export DUCKDNS_SUBDOMAIN=yourname
export DUCKDNS_TOKEN=your-duckdns-token
```

  and use `https://yourname.duckdns.org`.
- **Page doesn't load?** Check, in order: that **Allow HTTP traffic** and **Allow HTTPS traffic** are ticked on the VM (the `http-server` and `https-server` tags), that you used `https://`, that you replaced dots with dashes, and that 40 minutes have passed. Install progress is in `/var/log/beeper-autoreply-setup.log` on the VM.
