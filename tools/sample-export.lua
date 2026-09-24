-- Runs the addon inside the client emulation through a realistic session, including
-- awkward input, and prints its export. tools/export-contract.test.ts feeds the output
-- to the Worker's validator so the two sides of docs/EXPORT_FORMAT.md cannot drift.
--
-- Usage: luajit tools/sample-export.lua [json|csv] [bulk]

package.path = "tests/?.lua;" .. package.path

local wow = require("helpers.wow")
local addon = require("helpers.addon")

local format, bulk = arg[1] or "json", arg[2] == "bulk"

local env = wow.Create()
local ns = addon.Start(env)
env.printed = {}

local CREATURE = "Creature-0-4372-0-60-%d-00001A2B3C"

-- Offer pages, with a quest giver whose name carries escape codes and control characters.
env.units.questnpc = { guid = CREATURE:format(1234), name = "|cffff0000Scout|r\tof\1the Watch|" }
env.currentQuestID, env.currentQuestTitle = 92401, "|cffffd100Into|r the Ruins"
env:FireEvent("QUEST_DETAIL", 0)
env.currentQuestID, env.currentQuestTitle = 92753, "Destruction in Deadmines"
env:FireEvent("QUEST_DETAIL", 266001)

-- A position past the map edge and a level the pipeline would reject.
env.position = { 1.02, -0.01 }
env.questLevels[999999] = 250
env.currentQuestID, env.currentQuestTitle = 999999, "Mystery \"Quest\" \\ with, commas\nand lines"
env:FireEvent("QUEST_DETAIL", 0)
env.position = nil

-- Gossip, greeting, quest log, accept and turn in.
env.position = { 0.5, 0.25 }
env.units.npc = { guid = CREATURE:format(4321), name = "Innkeeper Farley" }
env.gossip.available = { { questID = 96393, title = "Hall of Thanes", questLevel = 30 } }
env.gossip.active = { { questID = 176, title = "Wanted: Hogger", questLevel = 11 } }
env:FireEvent("GOSSIP_SHOW")
env.greeting.available = { { questID = 76156, title = "Stalk With The Earthmother" } }
env.greeting.active = { { questID = 97288, title = "Lordaeron" } }
env:FireEvent("QUEST_GREETING")
env.questTitles[95189] = "Caf\195\169 in the Ruins"
env.questLog = { { questID = 95189, title = "Caf\195\169 in the Ruins", level = 22, questLogIndex = 1 } }
env:FireEvent("QUEST_LOG_UPDATE")
env:RunTimers()
env:FireEvent("QUEST_ACCEPTED", 95189)
env:FireEvent("QUEST_TURNED_IN", 95189, 1200, 0)

if bulk then
	-- Saved variables holding more quests than one export may carry (the recorder
	-- stops at the limit, but older data could exceed it): the export caps itself.
	local now = time()
	for questID = 150001, 155500 do
		ns.db.observations[questID] = {
			id = questID, title = "Bulk quest " .. questID, state = "inferred", contexts = { log = true },
			firstSeen = now, lastSeen = now, seenCount = 1,
		}
	end
end

local document = ns.Export.BuildDocument()
io.write(format == "csv" and ns.Export.ToCSV(document) or ns.Export.ToJSON(document))
