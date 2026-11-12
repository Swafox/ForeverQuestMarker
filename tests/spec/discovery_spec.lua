-- NPC tooltips, the journal, waypoints, the addon compartment and change details,
-- driven through the client emulation with community data injected per test.

local wow = require("helpers.wow")
local addon = require("helpers.addon")

local NPC_GUID = "Creature-0-4372-0-60-3142-00001A2B3C"
local CLASSIC = 176

local function Texts(lines)
	local texts = {}
	for _, line in ipairs(lines) do
		table.insert(texts, line.text)
	end
	return texts
end

local function Has(lines, pattern)
	for _, line in ipairs(lines) do
		if type(line.text) == "string" and line.text:find(pattern) then
			return true
		end
	end
	return false
end

local function Printed(env, pattern)
	for _, line in ipairs(env.printed) do
		if line:find(pattern) then
			return true
		end
	end
	return false
end

describe("discovery features", function()
	local env, ns

	before_each(function()
		env = wow.Create()
		ns = addon.Start(env)
		ns.Data.places = {
			[99048] = { "npc", 3142, 1411, 0.452, 0.612 },
			[99049] = { "npc", 3142, 1411 },
			[97903] = { "npc", 3142 },
			[97907] = { "npc", 5555, 1429, 0.3, 0.4 },
			[CLASSIC] = { "npc", 3142, 1429, 0.5, 0.5 },
		}
		ns.Places.Invalidate()
		env.questTitles[99048] = "A Missing Hand"
		env.questTitles[99049] = "Second Hand"
		env.questTitles[97907] = "Camping 101: Mining"
	end)

	after_each(function()
		assert.are.same({}, env.errors, "errors reached the game's error handler")
	end)

	describe("places", function()
		it("indexes community quest givers and the player's own recordings", function()
			assert.are.same({ CLASSIC, 97903, 99048, 99049 }, ns.Places.GetQuestsByGiver("npc", 3142))
			ns.Recorder.Observe(92401, "detail", { title = "Into the Ruins", giver = { type = "npc", id = 3142 } })
			assert.are.same({ CLASSIC, 92401, 97903, 99048, 99049 }, ns.Places.GetQuestsByGiver("npc", 3142))
			assert.are.same({}, ns.Places.GetQuestsByGiver("npc", 1))
			assert.are.same({}, ns.Places.GetQuestsByGiver("npc", nil))
		end)

		it("prefers community locations over the player's own sighting", function()
			ns.Recorder.Observe(99048, "detail", { title = "A Missing Hand" })
			local mapID, x, y, source = ns.Places.GetLocation(99048)
			assert.are.same({ 1411, 0.452, 0.612, "community" }, { mapID, x, y, source })
			ns.Recorder.Observe(92401, "detail", { title = "Into the Ruins" })
			mapID, x, y, source = ns.Places.GetLocation(92401)
			assert.are.same({ 1429, 0.452, 0.612, "own" }, { mapID, x, y, source })
			assert.are.equal(1411, (ns.Places.GetLocation(99049)))
			assert.is_nil(select(2, ns.Places.GetLocation(99049)))
			assert.is_nil(ns.Places.GetLocation(97903))
		end)

		it("resolves sub-zone maps to their zone", function()
			assert.are.same({ 1429, "Elwynn Forest" }, { ns.Places.GetZone(2001) })
			assert.are.same({ 1411, "Durotar" }, { ns.Places.GetZone(1411) })
			assert.are.same({ 777, "Map 777" }, { ns.Places.GetZone(777) })
		end)
	end)

	describe("NPC tooltips", function()
		it("lists the new quests an NPC offers, open quests first", function()
			env.completed[99048] = true
			env.onQuest[99049] = true
			local lines = env:ShowTooltipForUnit(NPC_GUID)
			assert.are.equal("New Forever quests: 3 (1 done)", lines[1].text)
			assert.is_truthy(lines[2].text:find("Quest 97903", 1, true))
			assert.is_truthy(lines[3].text:find("Second Hand (in your log)", 1, true))
			assert.is_truthy(lines[4].text:find("A Missing Hand (done)", 1, true))
			assert.is_truthy(lines[2].text:find("Badges", 1, true), "marker markup")
			assert.are.equal(4, #lines, "Classic quests are not listed")
		end)

		it("can hide completed quests and caps long lists", function()
			env.completed[99048] = true
			ns.db.settings.unitTooltipsHideDone = true
			local lines = env:ShowTooltipForUnit(NPC_GUID)
			assert.are.equal(3, #lines)
			assert.is_false(Has(lines, "A Missing Hand"))

			local many = {}
			local fixtures = dofile("tests/fixtures/quest_sets.lua")
			for i = 1, 9 do
				many[fixtures.datamined[i]] = { "npc", 4242 }
			end
			ns.Data.places = many
			ns.Places.Invalidate()
			lines = env:ShowTooltipForUnit("Creature-0-4372-0-60-4242-00001A2B3C")
			assert.are.equal("New Forever quests: 9", lines[1].text)
			assert.are.equal(8, #lines)
			assert.are.equal("...and 3 more", lines[8].text)
		end)

		it("ignores players, objects, secret GUIDs and NPCs without new quests", function()
			assert.are.same({}, Texts(env:ShowTooltipForUnit("Player-1234-0ABCDEF0")))
			assert.are.same({}, Texts(env:ShowTooltipForUnit("GameObject-0-4372-0-60-3142-00001A2B3C")))
			assert.are.same({}, Texts(env:ShowTooltipForUnit("Creature-0-4372-0-60-1-00001A2B3C")))
			env.secret[NPC_GUID] = true
			assert.are.same({}, Texts(env:ShowTooltipForUnit(NPC_GUID)))
		end)

		it("follows the settings", function()
			ns.db.settings.unitTooltips = false
			assert.are.same({}, Texts(env:ShowTooltipForUnit(NPC_GUID)))
			ns.db.settings.unitTooltips = true
			ns.db.settings.enabled = false
			assert.are.same({}, Texts(env:ShowTooltipForUnit(NPC_GUID)))
		end)
	end)

	describe("journal", function()
		it("summarizes progress by zone from community and own data", function()
			env.completed[99048] = true
			env.completed[92401] = true
			ns.Recorder.Observe(999999, "detail", { title = "Mystery" })
			local data = ns.Progress.Collect()
			local fixtures = dofile("tests/fixtures/quest_sets.lua")
			local confirmed = #fixtures.datamined + #fixtures.community
			assert.are.equal(confirmed + 1, data.total)
			assert.are.equal(2, data.done)

			assert.are.same({ "Durotar", "Elwynn Forest" }, { data.zones[1].name, data.zones[2].name })
			local durotar = data.zones[1]
			assert.are.equal(2, durotar.total)
			assert.are.equal(1, durotar.done)
			assert.are.same({ 99049, 99048 }, { durotar.quests[1].id, durotar.quests[2].id })
			local elwynn = data.zones[2]
			assert.are.same({ 97907, 999999 }, { elwynn.quests[1].id, elwynn.quests[2].id })
			assert.are.equal("inferred", elwynn.quests[2].state)
			assert.are.equal(data.total - 4, data.unlocated.total)
			assert.are.equal(1, data.unlocated.done)
		end)

		it("opens with the player's zone expanded and toggles zones and completed quests", function()
			local window = ns.Journal.Show()
			assert.is_true(window:IsShown())
			assert.is_truthy(window.Summary:GetText():find("^0 of 1,8%d%d new Forever quests completed %(0%%%)"))
			local rows = wow.FindWidgets(function(widget)
				return widget._type == "Button" and widget._parent == window.List and widget:IsShown()
			end)
			-- Durotar (collapsed), Elwynn Forest (expanded, the player's zone), its quest, the unlocated note.
			assert.are.equal(4, #rows)
			assert.are.equal("+ Durotar", rows[1].Text:GetText())
			assert.are.equal("- Elwynn Forest", rows[2].Text:GetText())
			assert.are.equal("Camping 101: Mining", rows[3].Text:GetText())
			assert.is_truthy(rows[4].Text:GetText():find("not located yet"))

			wow.FireScript(rows[1], "OnClick", "LeftButton")
			assert.are.equal("- Durotar", rows[1].Text:GetText())
			assert.are.equal("A Missing Hand", rows[2].Text:GetText())

			env.completed[99048] = true
			ns.Journal.Refresh()
			wow.FireScript(window.Filter, "OnClick", "LeftButton")
			assert.are.equal("Show completed", window.Filter:GetText())
			assert.are.equal("Second Hand", rows[2].Text:GetText())

			ns.Journal.Toggle()
			assert.is_false(window:IsShown())
			-- An explicit collapse survives reopening.
			wow.FireScript(rows[1], "OnClick", "LeftButton")
			ns.Journal.Show()
			assert.are.equal("- Elwynn Forest", rows[2].Text:GetText())
		end)

		it("keeps a fixed set of rows and fills them as the list scrolls", function()
			local fixtures = dofile("tests/fixtures/quest_sets.lua")
			local many = {}
			for i = 1, 60 do
				many[fixtures.datamined[i]] = { "npc", 1, 1429, 0.5, 0.5 }
				env.questTitles[fixtures.datamined[i]] = ("Quest %03d"):format(i)
			end
			ns.Data.places = many
			ns.Places.Invalidate()
			local window = ns.Journal.Show()
			local function Rows()
				return wow.FindWidgets(function(widget)
					return widget._type == "Button" and widget._parent == window.List
				end)
			end
			local created = #Rows()
			assert.is_true(created >= 15 and created <= 25, "rows: " .. created)
			assert.is_true(window.Scroll:IsShown(), "62 entries do not fit, so the scroll bar shows")
			assert.are.equal("- Elwynn Forest", Rows()[1].Text:GetText())
			assert.are.equal("Quest 001", Rows()[2].Text:GetText())

			wow.FireScript(window.Scroll, "OnVerticalScroll", 10 * 20)
			assert.are.equal("Quest 010", Rows()[1].Text:GetText())
			assert.are.equal(created, #Rows(), "scrolling creates no frames")

			-- Collapsing the zone clamps the offset back to the top.
			wow.FireScript(window.Scroll, "OnVerticalScroll", 0)
			wow.FireScript(Rows()[1], "OnClick", "LeftButton")
			assert.are.equal("+ Elwynn Forest", Rows()[1].Text:GetText())
			assert.is_false(window.Scroll:IsShown())
			wow.FireScript(Rows()[1], "OnClick", "LeftButton")
			wow.FireScript(window.Scroll, "OnVerticalScroll", 40 * 20)
			ns.db.journal.expanded[1429] = false
			ns.Journal.Render()
			assert.are.equal(0, FauxScrollFrame_GetOffset(window.Scroll))
			assert.are.equal("+ Elwynn Forest", Rows()[1].Text:GetText())
		end)

		it("sets a waypoint when a quest row is clicked", function()
			ns.Journal.Show()
			local rows = wow.FindWidgets(function(widget)
				return widget._type == "Button" and widget.quest ~= nil and widget:IsShown()
			end)
			wow.FireScript(rows[1], "OnClick", "LeftButton")
			assert.are.same({ uiMapID = 1429, position = { x = 0.3, y = 0.4 } }, { uiMapID = env.waypoint.uiMapID,
				position = env.waypoint.position })
			assert.is_true(env.superTracked)
			assert.is_true(Printed(env, "Waypoint set for Camping 101: Mining %(Elwynn Forest%)"))
		end)

		it("refreshes once after a burst of quest events while open", function()
			ns.Journal.Show()
			local before = #env.timers
			env:FireEvent("QUEST_TURNED_IN", 97907)
			env:FireEvent("QUEST_ACCEPTED", 99048)
			assert.are.equal(before + 1, #env.timers)
			env.completed[97907] = true
			env:RunTimers()
			local window = ForeverQuestMarkerJournal
			assert.is_truthy(window.Summary:GetText():find("^1 of"))
		end)

		it("asks for an uncached title once and refreshes only on a successful load", function()
			ns.Data.places = { [97903] = { "npc", 3142, 1429, 0.1, 0.1 } }
			ns.Places.Invalidate()
			ns.Journal.Show()
			assert.are.same({ 97903 }, env.loadRequests)
			local before = #env.timers
			env:FireEvent("QUEST_DATA_LOAD_RESULT", 97903, false)
			assert.are.equal(before, #env.timers)
			env:FireEvent("QUEST_DATA_LOAD_RESULT", 97903, true)
			assert.are.equal(before + 1, #env.timers)
			env:RunTimers()
			assert.are.same({ 97903 }, env.loadRequests)
		end)
	end)

	describe("waypoints", function()
		it("explains when a quest cannot be tracked", function()
			SlashCmdList.FOREVERQUESTMARKER("track 99049")
			assert.is_true(Printed(env, "position for Second Hand is not known yet"))
			ns.Data.places[99049] = { "npc", 3142, 947, 0.5, 0.5 }
			SlashCmdList.FOREVERQUESTMARKER("track 99049")
			assert.is_true(Printed(env, "Cannot place a waypoint for Second Hand"))
			SlashCmdList.FOREVERQUESTMARKER("track")
			assert.is_true(Printed(env, "Usage: /fqm track"))
			SlashCmdList.FOREVERQUESTMARKER("track 99048")
			assert.are.equal(1411, env.waypoint.uiMapID)
		end)
	end)

	describe("addon compartment", function()
		it("toggles the journal, opens settings and explains itself", function()
			ForeverQuestMarker_OnAddonCompartmentClick("ForeverQuestMarker", "LeftButton")
			assert.is_true(ns.Journal.IsShown())
			ForeverQuestMarker_OnAddonCompartmentClick("ForeverQuestMarker", "LeftButton")
			assert.is_false(ns.Journal.IsShown())
			ForeverQuestMarker_OnAddonCompartmentClick("ForeverQuestMarker", "RightButton")
			assert.are.equal(1, #env.settings.opened)

			local button = wow.NewWidget("Button", nil, UIParent)
			ForeverQuestMarker_OnAddonCompartmentEnter("ForeverQuestMarker", button)
			assert.is_true(GameTooltip:IsOwned(button))
			assert.is_truthy(GameTooltip.lines[2].text:find("^0 of 1,8%d%d new Forever quests completed$"))
			ForeverQuestMarker_OnAddonCompartmentLeave("ForeverQuestMarker", button)
			assert.is_false(GameTooltip:IsShown())
		end)

		it("is declared in the TOC", function()
			local metadata = addon.ReadToc()
			assert.are.equal("ForeverQuestMarker_OnAddonCompartmentClick", metadata.AddonCompartmentFunc)
			assert.are.equal("ForeverQuestMarker_OnAddonCompartmentEnter", metadata.AddonCompartmentFuncOnEnter)
			assert.are.equal("ForeverQuestMarker_OnAddonCompartmentLeave", metadata.AddonCompartmentFuncOnLeave)
		end)
	end)

	describe("change details", function()
		it("says what changed in a modified Classic quest", function()
			ns.Data.Sets.changed = { count = 1, segments = {}, ids = { CLASSIC } }
			ns.Data.changeKinds = { [CLASSIC] = { "objectives", "giver", "bogus" } }
			ns.Classifier.Reset()
			local lines = env:ShowTooltipForQuest(CLASSIC)
			assert.are.equal("Classic quest, modified in Forever", lines[1].text)
			assert.are.equal("Changed in Forever: quest giver, objectives.", lines[2].text)

			ns.Data.changeKinds = {}
			lines = env:ShowTooltipForQuest(CLASSIC)
			assert.are.equal(ns.L.STATE_CHANGED_NOTE, lines[2].text)
		end)
	end)
end)
