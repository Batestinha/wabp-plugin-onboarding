# Onboarding

A WABS plugin for WABP. It welcomes people **once**, the first time they arrive in a scope, whether the scope is a WhatsApp community with sub-groups or standalone groups.

- **Once per person per scope:** joining another group of the same scope (an event sub-group, say) never repeats it, and neither does being added back by the bot, for example after a suspension. Group history is a separate matter: Send Group History sends it per group.
- **Private delivery:** a welcome with the rules, a short guide built by the host from the same help data as `/help` (ending with "send /help any time"), and an optional account invitation that is skipped for people whose identity already has a linked sign-in account. If a private message can't be delivered, the welcome falls back to a mention in the group.
- **Current members are recorded first** when it is switched on, so they are never welcomed.
- **Welcome back:** someone who left every group of the scope and returns after a while (30 days by default) gets a short welcome back instead.

**Late welcome (one time):** `/onboarding catch-up` shows how many people were here before onboarding started and never had the welcome. `/onboarding catch-up start <that number>` sends it to them privately, once each, in paced batches (3 people every 5 minutes, 10:00–20:00 in the scope's time zone, by default), with its own opening line. People who left in the meantime, or are suspended or expelled, are skipped. `/onboarding catch-up stop` stops it; starting again only reaches those who didn't get it. The messages are prepared when it starts, and the admin who started it is told when it's done.

Commands: `/rules` for everyone; `/onboarding preview|status|resend|catch-up` for admins. Starts disabled. Needs WABP core API 0.3.25 (`newcomerGuideFor`, `identityAccess.hasLinkedAccount`). Translations: English and European Portuguese.
