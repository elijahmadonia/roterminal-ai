---
name: game-analytics
description: Add Roblox's own analytics events to a game (funnels, economy, custom events) so the owner and RoBot can see what players do inside it, where new players stop and how its economy flows.
---

# See inside the game

Most Roblox games send nothing about what happens inside them, so every answer about them stops at players, playtime and Robux. Roblox's `AnalyticsService` fixes that with no outside service: the events stay in Roblox's analytics, the owner sees them in Creator Hub, and RoBot reads them through the owner's connection (`ask_robot` about the game, or `my_game_numbers` part `inside`). No player ids ever leave Roblox.

**Start from the question.** `ask_robot` what it most needs to know about this game: usually where new players leave, whether the core loop gets repeated, and whether the economy inflates. Each event should answer one of those. Read the game's code first (`script_search`, `script_read`) and find where each moment already happens in it.

**Onboarding, first.** One funnel of the first few minutes, steps in order, each logged right after the player does it, once per player: `AnalyticsService:LogOnboardingFunnelStepEvent(player, step, "Step name")`. Steps start at 1 and follow the real path: joined, first action of the core loop, first reward, first upgrade or purchase screen. Six to ten steps.

**Loops that repeat.** A shop, a round, an upgrade path: `AnalyticsService:LogFunnelStepEvent(player, "Shop", funnelSessionId, step, "Step name")`, with `HttpService:GenerateGUID()` as the session id for each time through (or `<playerId>-<itemId>` for an upgrade path).

**The economy.** Every currency in and out, from the server, after the balance changes: `AnalyticsService:LogEconomyEvent(player, Enum.AnalyticsEconomyFlowType.Source or .Sink, "Coins", amount, balanceAfter, Enum.AnalyticsEconomyTransactionType.Gameplay.Name, "ItemSku")`. Amounts are always positive. Use the transaction types that fit (Gameplay, Shop, IAP, TimedReward, Onboarding, ContextualPurchase) and an item SKU for anything bought, so RoBot can see what players spend on.

**Moments that matter.** `AnalyticsService:LogCustomEvent(player, "RebirthDone")`, or with a value (`"RoundLength", seconds`). Rebirths, deaths by cause, a boss beaten, a trade, a pet hatched. Batch noisy ones as a value rather than one event each.

**Roblox's limits.** 10 funnels, 100 steps a funnel, 100 custom event names, 10 currencies, 3 custom fields (put variants like class or level in a custom field, not in the name), and 120 + 20 × players events a minute for the whole game. Progression events (`LogProgressionEvent`) don't reach apps: use a funnel or a custom event instead. Server scripts only.

**Ship it.** It goes out in an update, and publishing is the owner's yes (`work` action `confirm`). Check events arrive with Creator Hub's View Events tool; Roblox's charts take about a day. Then `ask_robot` again: it reads them as soon as Roblox has them.

**Names are forever.** Use clear names now ("TutorialDone", not "evt3"): they show to the owner, in Creator Hub and in RoBot's answers. `work` `log` what was added and why, so the next session knows.
