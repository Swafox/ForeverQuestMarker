local wow = require("helpers.wow")
local addon = require("helpers.addon")

describe("Classifier", function()
	local ns, State, Classifier, fixtures

	before_each(function()
		wow.Create()
		ns = addon.Load()
		State, Classifier = ns.State, ns.Classifier
		fixtures = dofile("tests/fixtures/quest_sets.lua")
	end)

	it("classifies well-known original Classic quests as Classic", function()
		-- Wanted: Hogger, The Defias Brotherhood, Bolstering Our Defenses (the highest vanilla ID).
		for _, questID in ipairs({ 176, 155, 9665 }) do
			local state, reason = Classifier.Classify(questID)
			assert.are.equal(State.CLASSIC, state, "quest " .. questID)
			assert.are.equal("classic", reason)
		end
	end)

	it("keeps Classic Era-only additions from QuestieDB corrections as Classic", function()
		assert.are.equal(State.CLASSIC, (Classifier.Classify(65593)))
	end)

	it("confirms quests found only in the Forever client data", function()
		-- Examples cited by community datamines of beta build 1.60.1.
		for _, questID in ipairs({ 92401, 92753, 96393, 97288 }) do
			local state, reason = Classifier.Classify(questID)
			assert.are.equal(State.CONFIRMED, state, "quest " .. questID)
			assert.are.equal("datamined", reason)
		end
	end)

	it("recognises Season of Discovery quests without calling them new", function()
		local state, reason = Classifier.Classify(76156)
		assert.are.equal(State.SOD, state)
		assert.are.equal("sod", reason)
	end)

	it("labels other Classic Era client quests as Era", function()
		local questID = fixtures.era[1]
		assert.are.equal(State.ERA, (Classifier.Classify(questID)))
	end)

	it("infers quests missing from every list as likely new", function()
		local unlisted = 999999
		local state, reason = Classifier.Classify(unlisted)
		assert.are.equal(State.INFERRED, state)
		assert.are.equal("unlisted", reason)
	end)

	it("keeps the three Classic quests that gained Forever client rows as Classic", function()
		for _, questID in ipairs({ 3382, 8193, 8249 }) do
			assert.are.equal(State.CLASSIC, (Classifier.Classify(questID)))
		end
	end)

	it("returns Unknown for invalid IDs", function()
		for _, value in ipairs({ 0, -5, 1.5, "176" }) do
			assert.are.equal(State.UNKNOWN, (Classifier.Classify(value)))
		end
		assert.are.equal(State.UNKNOWN, (Classifier.Classify(nil)))
	end)

	it("checks changed quests before Classic", function()
		ns.Data.Sets.changed = { count = 1, segments = {}, ids = { 176 } }
		Classifier.Reset()
		local state, reason = Classifier.Classify(176)
		assert.are.equal(State.CHANGED, state)
		assert.are.equal("changed", reason)
	end)

	it("confirms community-reported quests that the datamine missed", function()
		ns.Data.Sets.community = { count = 1, segments = {}, ids = { 150001 } }
		Classifier.Reset()
		local state, reason = Classifier.Classify(150001)
		assert.are.equal(State.CONFIRMED, state)
		assert.are.equal("community", reason)
	end)

	it("never lets the generated sets overlap in a way that changes precedence", function()
		local classic = {}
		for _, id in ipairs(fixtures.classic) do
			classic[id] = true
		end
		for _, name in ipairs({ "datamined", "community", "sod", "era" }) do
			for _, id in ipairs(fixtures[name]) do
				assert.is_nil(classic[id], name .. " contains Classic quest " .. id)
			end
		end
	end)
end)

describe("Display", function()
	local ns, Display

	before_each(function()
		wow.Create()
		ns = addon.Load()
		ns.DB.Initialize()
		Display = ns.Display
	end)

	it("marks confirmed, inferred and Season of Discovery quests but not Classic ones", function()
		assert.are.equal("confirmed", Display.GetMarker(92401))
		assert.are.equal("inferred", Display.GetMarker(999999))
		assert.are.equal("sod", Display.GetMarker(76156))
		assert.is_nil(Display.GetMarker(176))
	end)

	it("follows the settings", function()
		ns.db.settings.distinguishInferred = false
		assert.are.equal("confirmed", Display.GetMarker(999999))
		ns.db.settings.showInferred = false
		assert.is_nil(Display.GetMarker(999999))
		ns.db.settings.showSoD = false
		assert.is_nil(Display.GetMarker(76156))
		ns.db.settings.markGossip = false
		assert.is_nil(Display.GetMarker(92401, "markGossip"))
		assert.are.equal("confirmed", Display.GetMarker(92401, "markQuestLog"))
		ns.db.settings.enabled = false
		assert.is_nil(Display.GetMarker(92401))
	end)

	it("builds tooltip text only for marked quests", function()
		local headline, note, r = Display.GetTooltipInfo(92401)
		assert.are.equal(ns.L.STATE_CONFIRMED, headline)
		assert.is_string(note)
		assert.is_number(r)
		assert.is_nil(Display.GetTooltipInfo(176))
		ns.db.settings.tooltips = false
		assert.is_nil(Display.GetTooltipInfo(92401))
	end)

	it("formats colored text tags", function()
		assert.are.equal("|cffe6c067New|r", Display.GetTag("confirmed"))
		assert.are.equal("", Display.GetTag("nope"))
	end)
end)
