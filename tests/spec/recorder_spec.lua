local wow = require("helpers.wow")
local addon = require("helpers.addon")
local json = require("dkjson")

local CREATURE_GUID = "Creature-0-4372-0-60-1234-00001A2B3C"

describe("Recorder", function()
	local env, ns, Recorder

	before_each(function()
		env = wow.Create()
		ns = addon.Start(env)
		Recorder = ns.Recorder
	end)

	describe("SanitizeTitle", function()
		it("strips color codes, textures, atlases and links", function()
			local title = "|cffffd100Into|r the |TInterface\\Icons\\X:14|t|A:questlog:14:14|aRuins |Hquest:1|h[Deep]|h"
			assert.are.equal("Into the Ruins [Deep]", Recorder.SanitizeTitle(title))
		end)

		it("collapses whitespace and control characters", function()
			assert.are.equal("A B", Recorder.SanitizeTitle("  A\n\tB  "))
		end)

		it("truncates long titles on a UTF-8 boundary", function()
			local title = string.rep("a", 199) .. "\195\169" .. "tail"
			local sanitized = Recorder.SanitizeTitle(title)
			assert.are.equal(string.rep("a", 199), sanitized)
		end)

		it("returns nil for empty or non-string input", function()
			assert.is_nil(Recorder.SanitizeTitle(""))
			assert.is_nil(Recorder.SanitizeTitle("|cffffffff|r"))
			assert.is_nil(Recorder.SanitizeTitle(nil))
		end)
	end)

	describe("GetGiverFromUnit", function()
		it("reads creature IDs and names from the GUID", function()
			env.units.npc = { guid = CREATURE_GUID, name = "Marshal Dughan" }
			assert.are.same({ type = "npc", id = 1234, name = "Marshal Dughan" }, Recorder.GetGiverFromUnit("npc"))
		end)

		it("recognises game objects", function()
			env.units.questnpc = { guid = "GameObject-0-4372-0-60-2059-00001A2B3C", name = "Wanted Poster" }
			assert.are.equal("object", Recorder.GetGiverFromUnit("questnpc").type)
		end)

		it("strips escape codes and control characters from names", function()
			env.units.npc = { guid = CREATURE_GUID, name = "|cffff0000Scout|r\tof the Watch|" }
			assert.are.equal("Scout of the Watch", Recorder.GetGiverFromUnit("npc").name)
		end)

		it("ignores players and secret values", function()
			env.units.npc = { guid = "Player-1234-0ABCDEF0", name = "Someone" }
			assert.is_nil(Recorder.GetGiverFromUnit("npc"))
			env.units.npc = { guid = CREATURE_GUID, name = "Hidden" }
			env.secret[CREATURE_GUID] = true
			assert.is_nil(Recorder.GetGiverFromUnit("npc"))
			assert.is_nil(Recorder.GetGiverFromUnit("target"))
		end)
	end)

	describe("Observe", function()
		it("records new quests with location, faction and context", function()
			local record = Recorder.Observe(92401, "detail", { title = "Into the Ruins", level = 17 })
			assert.are.equal(92401, record.id)
			assert.are.equal("confirmed", record.state)
			assert.are.equal(1429, record.map)
			assert.are.equal(0.452, record.x)
			assert.are.equal(0.612, record.y)
			assert.are.equal("Alliance", record.faction)
			assert.is_true(record.contexts.detail)
			assert.are.equal(1, record.seenCount)
			assert.are.equal(1, Recorder.Count())
		end)

		it("omits positions outside the map and implausible levels", function()
			env.position = { 1.02, 0.5 }
			local record = Recorder.Observe(92401, "detail", { title = "Into the Ruins", level = 250 })
			assert.are.equal(1429, record.map)
			assert.is_nil(record.x)
			assert.is_nil(record.y)
			assert.is_nil(record.level)
		end)

		it("stores no position inside instances", function()
			env.position = nil
			local record = Recorder.Observe(92401, "detail", { title = "Into the Ruins" })
			assert.are.equal(1429, record.map)
			assert.is_nil(record.x)
		end)

		it("takes the location only where an NPC shows the quest, filling it in later", function()
			local record = Recorder.Observe(92401, "log", { title = "Into the Ruins" })
			assert.is_nil(record.map)
			env.position = { 0.25, 0.75 }
			Recorder.Observe(92401, "gossip", { title = "Into the Ruins" })
			assert.are.equal(1429, record.map)
			assert.are.equal(0.25, record.x)
			env.position = { 0.9, 0.9 }
			Recorder.Observe(92401, "detail", { title = "Into the Ruins" })
			assert.are.equal(0.25, record.x)
		end)

		it("counts sightings by quest givers, not quest log scans", function()
			local clock = os.time()
			_G.time = function()
				return clock
			end
			local record = Recorder.Observe(92401, "detail", { title = "Into the Ruins" })
			clock = clock + 600
			Recorder.Observe(92401, "log", {})
			assert.are.equal(1, record.seenCount)
			Recorder.Observe(92401, "gossip", {})
			assert.are.equal(2, record.seenCount)
			clock = clock + 10
			Recorder.Observe(92401, "gossip", {})
			assert.are.equal(2, record.seenCount)
			assert.are.equal(clock, record.lastSeen)
		end)

		it("merges repeated sightings into one record", function()
			Recorder.Observe(92401, "gossip", { title = "Into the Ruins", giver = { type = "npc", id = 5 } })
			local record = Recorder.Observe(92401, "detail", { title = "Into the Ruins", giver = { type = "npc", id = 9 } })
			assert.are.equal(1, Recorder.Count())
			assert.are.equal(1, record.seenCount)
			assert.are.equal(5, record.giver.id)
			assert.is_true(record.contexts.gossip and record.contexts.detail)
		end)

		it("skips Classic quests when change detection recording is off", function()
			ns.db.settings.recordClassic = false
			assert.is_nil(Recorder.Observe(176, "detail", { title = "Wanted: Hogger" }))
			ns.db.settings.recordClassic = true
			assert.are.equal("classic", Recorder.Observe(176, "detail", { title = "Wanted: Hogger" }).state)
		end)

		it("records nothing when the recorder is off or the ID is invalid", function()
			ns.db.settings.recorder = false
			assert.is_nil(Recorder.Observe(92401, "detail", {}))
			ns.db.settings.recorder = true
			assert.is_nil(Recorder.Observe(0, "detail", {}))
		end)

		it("can be reset", function()
			Recorder.Observe(92401, "detail", { title = "A" })
			Recorder.Observe(999999, "detail", { title = "B" })
			assert.are.equal(2, Recorder.Reset())
			assert.are.equal(0, Recorder.Count())
			assert.are.same({}, ns.db.observations)
		end)
	end)

	describe("event handling", function()
		it("records offered quests from QUEST_DETAIL with the quest giver", function()
			env.units.questnpc = { guid = CREATURE_GUID, name = "Scout" }
			env.currentQuestID, env.currentQuestTitle = 92753, "Destruction in Deadmines"
			env:FireEvent("QUEST_DETAIL", 0)
			local record = ns.db.observations[92753]
			assert.are.equal("Destruction in Deadmines", record.title)
			assert.are.same({ type = "npc", id = 1234, name = "Scout" }, record.giver)
		end)

		it("records the starting item for quests started from items", function()
			env.currentQuestID, env.currentQuestTitle = 92753, "Destruction in Deadmines"
			env:FireEvent("QUEST_DETAIL", 266001)
			assert.are.same({ type = "item", id = 266001 }, ns.db.observations[92753].giver)
		end)

		it("records gossip and greeting lists", function()
			env.units.npc = { guid = CREATURE_GUID, name = "Scout" }
			env.gossip.available = { { questID = 96393, title = "Hall of Thanes", questLevel = 30 } }
			env.gossip.active = { { questID = 176, title = "Wanted: Hogger", questLevel = 11 } }
			env:FireEvent("GOSSIP_SHOW")
			assert.are.equal(30, ns.db.observations[96393].level)
			assert.is_true(ns.db.observations[176].contexts.gossip)

			env.greeting.available = { { questID = 999999, title = "Mystery" } }
			env.greeting.active = { { questID = 97288, title = "Lordaeron" } }
			env:FireEvent("QUEST_GREETING")
			assert.are.equal("inferred", ns.db.observations[999999].state)
			assert.is_true(ns.db.observations[97288].contexts.greeting)
		end)

		it("records quests offered by items through the auto quest pop-up", function()
			env.questTitles[92753] = "Destruction in Deadmines"
			env:OfferQuestFromItem(92753, 266001)
			local record = ns.db.observations[92753]
			assert.are.equal("Destruction in Deadmines", record.title)
			assert.are.same({ type = "item", id = 266001 }, record.giver)
		end)

		it("fills in a title once the client loads the quest data", function()
			env:OfferQuestFromItem(92753, 266001)
			assert.is_nil(ns.db.observations[92753].title)
			env.questTitles[92753] = "Destruction in Deadmines"
			env:FireEvent("QUEST_DATA_LOAD_RESULT", 92753, true)
			assert.are.equal("Destruction in Deadmines", ns.db.observations[92753].title)
		end)

		it("ignores hidden quests on accept and unknown quests on turn-in", function()
			env.questLog = { { questID = 95189, title = "Flag", isHidden = true, questLogIndex = 1 } }
			env:FireEvent("QUEST_ACCEPTED", 95189)
			env:FireEvent("QUEST_TURNED_IN", 95250, 0, 0)
			assert.is_nil(ns.db.observations[95189])
			assert.is_nil(ns.db.observations[95250])
		end)

		it("records the level the quest log shows", function()
			env.questLog = { { questID = 92401, title = "Into the Ruins", level = 15, difficultyLevel = 17, questLogIndex = 1 } }
			env:FireEvent("QUEST_LOG_UPDATE")
			env:RunTimers()
			assert.are.equal(17, ns.db.observations[92401].level)
		end)

		it("records accepted and completed quests", function()
			env.questTitles[92401] = "Into the Ruins"
			env.questLevels[92401] = 17
			env:FireEvent("QUEST_ACCEPTED", 92401)
			env:FireEvent("QUEST_TURNED_IN", 92401, 100, 0)
			local record = ns.db.observations[92401]
			assert.is_true(record.accepted)
			assert.is_true(record.turnedIn)
			assert.are.equal(17, record.level)
		end)

		it("scans the quest log after updates, once per burst", function()
			env.questLog = {
				{ isHeader = true, title = "Elwynn Forest", questID = 0 },
				{ questID = 92401, title = "Into the Ruins", level = 17, questLogIndex = 2 },
				{ questID = 95189, title = "Hidden", level = 20, isHidden = true, questLogIndex = 3 },
			}
			env:FireEvent("QUEST_LOG_UPDATE")
			env:FireEvent("QUEST_LOG_UPDATE")
			assert.are.equal(1, #env.timers)
			env:RunTimers()
			assert.is_true(ns.db.observations[92401].contexts.log)
			assert.is_nil(ns.db.observations[95189])
		end)
	end)
end)

describe("Export", function()
	local env, ns

	before_each(function()
		env = wow.Create()
		ns = addon.Start(env)
		ns.Recorder.Observe(176, "detail", { title = 'Wanted: "Hogger", again' })
		ns.Recorder.Observe(92401, "detail", {
			title = "Into the Ruins",
			level = 17,
			giver = { type = "npc", id = 1234, name = "Scout" },
		})
		ns.Recorder.Observe(999999, "gossip", { title = "Mystery\\Quest" })
	end)

	it("builds a document matching docs/EXPORT_FORMAT.md", function()
		local text = ns.Export.ToJSON(ns.Export.BuildDocument())
		local document, _, err = json.decode(text)
		assert.is_nil(err)
		assert.are.equal("ForeverQuestMarker", document.format)
		assert.are.equal(1, document.version)
		assert.are.equal("dev", document.addonVersion)
		assert.are.equal("1.60.1.69977", document.build)
		assert.are.equal(16001, document.interface)
		assert.are.equal("enUS", document.locale)
		assert.is_truthy(document.clientId:match("^%x+$"))
		assert.are.equal(16, #document.clientId)
		assert.are.equal(3, document.count)
		assert.are.equal(document.count, #document.quests)

		-- New quests first, then likely new, then Classic.
		assert.are.same({ 92401, 999999, 176 }, { document.quests[1].id, document.quests[2].id, document.quests[3].id })
		local quest = document.quests[1]
		assert.are.equal("confirmed", quest.state)
		assert.are.equal(17, quest.level)
		assert.are.same({ type = "npc", id = 1234, name = "Scout" }, quest.giver)
		assert.are.same({ "detail" }, quest.contexts)
		assert.are.equal(0.452, quest.x)
		assert.are.equal('Wanted: "Hogger", again', document.quests[3].title)
		assert.are.equal("Mystery\\Quest", document.quests[2].title)
	end)

	it("puts one quest per line", function()
		local text = ns.Export.ToJSON(ns.Export.BuildDocument())
		local lines = 0
		for _ in text:gmatch("\n") do
			lines = lines + 1
		end
		assert.are.equal(4, lines)
	end)

	it("writes an empty quest list as valid JSON", function()
		ns.Recorder.Reset()
		local document = json.decode(ns.Export.ToJSON(ns.Export.BuildDocument()))
		assert.are.equal(0, document.count)
	end)

	it("writes CSV with quoted fields", function()
		local csv = ns.Export.ToCSV(ns.Export.BuildDocument())
		local lines = {}
		for line in csv:gmatch("[^\n]+") do
			table.insert(lines, line)
		end
		assert.are.equal(4, #lines)
		local header = "id,title,state,level,giverType,giverId,giverName,map,x,y,faction,contexts,"
			.. "firstSeen,lastSeen,seenCount,accepted,turnedIn"
		assert.are.equal(header, lines[1])
		assert.is_truthy(lines[2]:find("^92401,Into the Ruins,confirmed,17,npc,1234,Scout,1429,0.452,0.612,Alliance,detail,"))
		assert.is_truthy(lines[4]:find('^176,"Wanted: ""Hogger"", again",classic,'))
	end)

	it("escapes control characters in JSON strings", function()
		ns.db.observations[92401].title = "Tab\there"
		local document = json.decode(ns.Export.ToJSON(ns.Export.BuildDocument()))
		assert.are.equal("Tab\there", document.quests[1].title)
	end)
end)
