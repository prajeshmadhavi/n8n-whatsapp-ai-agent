# n8n WhatsApp AI Agent: qualify leads and book calls

An n8n workflow you can import. It answers inbound WhatsApp messages through the official WhatsApp Cloud API (Meta, direct, no Twilio or other BSP), qualifies the lead with Claude, offers free slots from Google Calendar, books the one the customer picks, and replies on WhatsApp. Optionally it logs each qualified lead to Google Sheets.

Status: structure validated with `scripts/validate.mjs`. Import-tested on n8n: not yet.

## What it does

```
GET  /webhook/whatsapp   (Meta verification, once)
  Meta Verify (GET) -> Verify Token Matches? --yes--> Return Challenge (200, hub.challenge)
                                             --no---> Reject (403)

POST /webhook/whatsapp   (every WhatsApp event)
  WhatsApp Inbound (POST)          responds 200 immediately
    -> Extract Message             drops status updates, keeps from / name / text
    -> AI Agent                    qualify -> offer slots -> book
         model:  Claude Chat Model (Anthropic)
         memory: Conversation Memory (last 10 turns, keyed by sender's WhatsApp ID)
         tools:  Check Availability   (Google Calendar, busy slots)
                 Book Appointment     (Google Calendar, create event)
                 Save Lead            (Google Sheets append, disabled by default)
    -> Send WhatsApp Reply         POST graph.facebook.com/v23.0/<PHONE_NUMBER_ID>/messages
```

A typical chat:

```
Customer: Hi, do you build booking systems?
Agent:    Hi Anna, yes we do. What would the booking system be for?
Customer: A dental clinic, 3 doctors.
Agent:    Got it. Do you have a rough budget in mind?
Customer: Around 5k
Agent:    Thanks. And when would you want it live?
Customer: Within 2 months
Agent:    That works. I can do a 30 min call Tue 11:00, Tue 15:30 or Wed 10:00. Which suits you?
Customer: Wed 10
Agent:    Booked: Wednesday 10:00 to 10:30. You'll get a calendar invite from the team.
```

## What you need

- A Meta developer app with the WhatsApp product added, and a WhatsApp Business phone number on the Cloud API. You need its Phone Number ID and an access token (a System User token for production; the temporary token expires in 24 hours).
- n8n (self-hosted or cloud) with a public HTTPS URL. Meta will not call `localhost`.
- An Anthropic API key.
- A Google account with Google Calendar, connected to n8n through OAuth.
- Optional: a Google Sheet for leads.

## Setup

1. **Import.** In n8n: Workflows, Import from File, pick `workflows/whatsapp-ai-agent.json`.

2. **Credentials.** The JSON only references credentials by name. Create these in n8n and select them on each node:

   | Node                    | Credential type             | Name in the JSON          |
   |-------------------------|-----------------------------|---------------------------|
   | Claude Chat Model       | Anthropic                   | Anthropic account         |
   | Check Availability      | Google Calendar OAuth2      | Google Calendar account   |
   | Book Appointment        | Google Calendar OAuth2      | Google Calendar account   |
   | Save Lead (optional)    | Google Sheets OAuth2        | Google Sheets account     |
   | Send WhatsApp Reply     | Bearer Auth                 | WhatsApp Cloud API token  |

   For "WhatsApp Cloud API token", paste your Meta access token as the Bearer token. Never put it in the workflow JSON.

3. **Placeholders.** Replace these:

   | Where                                   | Placeholder            |
   |-----------------------------------------|------------------------|
   | Verify Token Matches? (second condition) | `YOUR_VERIFY_TOKEN`    |
   | Send WhatsApp Reply, URL                | `YOUR_PHONE_NUMBER_ID` |
   | AI Agent, system message                | `YOUR_BUSINESS_NAME`, `YOUR_SERVICES`, working hours |
   | Check Availability, Book Appointment    | calendar `primary` (or a calendar ID) |
   | Save Lead                               | `YOUR_SPREADSHEET_ID`, sheet |

   The verify token is any string you choose. You type the same string into Meta in step 5.
   Check the Graph API version in the URL (`v23.0`) against the version your Meta app uses.

4. **Activate** the workflow and copy the production URL of the webhook nodes. Both use the path `whatsapp`, so it looks like `https://<your-n8n>/webhook/whatsapp`.

5. **Meta App Dashboard.** WhatsApp, Configuration, Webhook:
   - Callback URL: the production URL from step 4.
   - Verify token: the same string as `YOUR_VERIFY_TOKEN`.
   - Click Verify and save. Meta sends the GET request; the workflow echoes `hub.challenge`.
   - Under Webhook fields, subscribe to `messages`.

6. **Optional Sheets logging.** Create a sheet with these headers in row 1: `Date, WhatsApp Number, Name, Need, Budget, Timeline, Status, Booked Slot`. Enable the "Save Lead" node and point it at the sheet.

7. Send a WhatsApp message to the business number and watch the execution in n8n.

## How the agent decides

The rules live in the AI Agent system message, so you can change them without touching the flow.

1. **Qualify.** Asks, one question at a time, what they need, their budget, and their timeline.
2. **Offer slots.** If it is a fit, calls Check Availability for the next 5 working days. The tool returns busy slots; the agent picks 2 or 3 free 30-minute slots inside working hours. It is told never to offer a time it has not checked.
3. **Book.** When the customer picks one, calls Book Appointment with the start and end time, a summary, and a description holding need, budget, timeline and number. Then confirms back.
4. **Log.** If Save Lead is enabled, appends the lead with its status (qualified, booked, not a fit).
5. **Not a fit.** Says so politely and says the team may follow up.

Replies are kept to 1 to 3 plain-text sentences. The agent does not quote prices.

Memory is a window of the last 10 exchanges per sender, keyed by their WhatsApp ID. It is stored in n8n's process memory, so it resets when n8n restarts. For production, swap Conversation Memory for a Postgres or Redis chat memory node with the same session key.

## WhatsApp gotchas worth knowing

- **24-hour customer service window.** You can send free-form replies only within 24 hours of the customer's last message. This workflow always replies to an inbound message, so it stays inside the window. If you later add follow-ups or reminders outside it, you need an approved message template instead.
- **Respond fast.** Meta retries a webhook delivery if it does not get a 200 quickly. The POST webhook answers 200 on receipt, before the agent runs, so slow AI or calendar calls do not cause duplicate deliveries. Retries can still happen (network blips), so for production consider de-duplicating on `messageId`.
- **Status webhooks arrive too.** The same webhook receives `statuses` events (sent, delivered, read) for every message you send. "Extract Message" ignores anything that is not an inbound message, otherwise the agent would reply to its own delivery receipts.
- **Non-text messages.** Images, voice notes and so on are passed to the agent as a short note saying it can only read text, so the customer gets a sensible reply instead of silence.
- **Test numbers.** In development mode, Meta only delivers to phone numbers you have added as test recipients.

## Files

```
workflows/whatsapp-ai-agent.json   the n8n workflow
scripts/validate.mjs               structural check, no dependencies
```

## Validate

```
node scripts/validate.mjs
```

Checks that the JSON parses, every node has `id`, `name`, `type`, `typeVersion`, `position` and `parameters`, every connection points at a real node, credentials carry a name only, and no string looks like a secret. Exits 1 on any failure.

## About

Built by Prajesh Madhavi, Noesis Infotech (Thane, India).

## License

MIT. See [LICENSE](LICENSE).
