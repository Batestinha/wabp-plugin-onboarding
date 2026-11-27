# Onboarding & Updates

Welcomes newcomers with group rules and a guide to available commands. Administrators publish editions that members can read with /updates or subscribe to receive privately.

- **Once per person per scope:** joining another group of the same scope (an event sub-group, say) never repeats it, and neither does being added back by the bot, for example after a suspension. Group history is a separate matter: Archive Courier sends it per group.
- **Private delivery:** a welcome with the rules, a short guide built by the host from the same help data as `/help` (ending with "send /help any time"), and an optional account invitation that is skipped for people whose identity already has a linked sign-in account. If a private message can't be delivered, the welcome falls back to a mention in the group.
- **Current members are recorded first** when it is switched on, so they are never welcomed.
- **Welcome back:** someone who left every group of the scope and returns after a while (30 days by default) gets a short welcome back instead.

**Late welcome (one time):** `/onboarding catch-up` shows how many people were here before onboarding started and never had the welcome. `/onboarding catch-up start <that number>` sends it to them privately, once each, in paced batches (3 people every 5 minutes, 10:00–20:00 in the scope's time zone, by default), with its own opening line. People who left in the meantime, or are suspended or expelled, are skipped. `/onboarding catch-up stop` stops it; starting again only reaches those who didn't get it. The messages are prepared when it starts, and the admin who started it is told when it's done.

## Updates

Use `/updates` for unread editions in your community. `/updates on` subscribes to private updates and `/updates off` stops automatic delivery. A community’s subscription starts off and applies across its subgroups. Members can always request their unread editions while eligible.

Open **Updates** in the scope’s plugin settings to write a draft, review changes to effective rules or member-facing help, see the member message and eligible subscriber count, and publish. Dismissing or saving a draft keeps it private. Published editions keep their original text. Multiple edits and translated help labels do not create duplicate editions.

Use **Welcome and rules**, **Guide and invitation**, **Returning members**, and **Late welcomes and delivery** to edit the messages people receive. The WABP message editor lets you insert the member name and community or group name in personalized messages and preview them with sample values. Group Administration Assistant supplies the published rule text. Edition bodies support multiline wording and preserve literal braces.

Automatic delivery uses the late-welcome batch size, interval and local sending hours. The bot checks current membership, moderation standing and subscription at dispatch. Each edition stays unread until the outbox confirms delivery. A failed edition can be requested again with `/updates`.

`/updates` is available to members. `/subscriptions` also manages the community’s update preference. Group Administration Assistant provides `/rules`. Administrators retain `/onboarding preview|status|resend|catch-up`. The plugin starts disabled and requires WABP core API 0.3.32. It includes English and European Portuguese.
