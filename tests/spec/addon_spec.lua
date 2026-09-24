-- Boots the whole addon through its TOC inside the client emulation and drives
-- every Blizzard frame it hooks.

local wow = require("helpers.wow")
local addon = require("helpers.addon")

local NEW = 92401 -- datamined as new in Forever
local NEW_TITLE = "Into the Ruins"
local CLASSIC = 176 -- Wanted: Hogger
local LIKELY = 999999 -- in no list at all
local SOD = 76156

local function Printed(env, pattern)
	for _, line in ipairs(env.printed) do
		if line:find(pattern) then
			return true
		end
	end
	return false
end

local function TooltipHas(text)
	for _, line in ipairs(GameTooltip.lines) do
		if line.text == text then
			return true
		end
	end
	return false
end

describe("ForeverQuest Marker in the client emulation", function()
	local env, ns

	before_each(function()
		env = wow.Create()
		ns = addon.Start(env)
	end)

	after_each(function()
		assert.are.same({}, env.errors, "errors reached the game's error handler")
	end)

	describe("startup", function()
		it("installs every integration", function()
			for _, spec in ipairs(ns.Integrations.List()) do
				assert.are.equal("installed", spec.status, spec.key .. ": " .. tostring(spec.detail))
			end
		end)

		it("registers slash commands and the settings category", function()
			assert.is_function(SlashCmdList.FOREVERQUESTMARKER)
			assert.are.equal("/fqm", SLASH_FOREVERQUESTMARKER1)
			assert.are.equal(ns.L.ADDON_TITLE, env.settings.registered.name)
			assert.are.equal(16, #env.settings.checkboxes)
		end)

		it("creates saved variables with defaults and a client ID", function()
			assert.is_table(ForeverQuestMarkerDB)
			assert.is_true(ForeverQuestMarkerDB.settings.enabled)
			assert.are.equal(16, #ForeverQuestMarkerDB.clientId)
		end)

		it("keeps saved settings across a reload and repairs bad values", function()
			ForeverQuestMarkerDB.settings.markGossip = false
			ForeverQuestMarkerDB.settings.tooltips = "yes"
			local saved = _G.ForeverQuestMarkerDB
			env = wow.Create()
			_G.ForeverQuestMarkerDB = saved
			ns = addon.Start(env)
			assert.is_false(ns.db.settings.markGossip)
			assert.is_true(ns.db.settings.tooltips)
		end)

		it("reports integrations whose frames are missing instead of failing", function()
			env = wow.Create()
			_G.QuestScrollFrame = nil
			_G.QuestInfo_Display = nil
			ns = addon.Start(env)
			local status = {}
			for _, spec in ipairs(ns.Integrations.List()) do
				status[spec.key] = spec.status
			end
			assert.are.equal("unavailable", status.questLog)
			assert.are.equal("unavailable", status.questFrame)
			assert.are.equal("installed", status.gossip)
		end)

		it("waits for a Blizzard addon that loads later", function()
			env = wow.Create()
			env.loadedAddOns.Blizzard_ObjectiveTracker = false
			ns = addon.Start(env)
			local tracker
			for _, spec in ipairs(ns.Integrations.List()) do
				if spec.key == "tracker" then
					tracker = spec
				end
			end
			assert.are.equal("pending", tracker.status)
			env.loadedAddOns.Blizzard_ObjectiveTracker = true
			env:FireEvent("ADDON_LOADED", "Blizzard_ObjectiveTracker")
			assert.are.equal("installed", tracker.status)
		end)
	end)

	describe("quest window", function()
		it("prefixes new quest titles with the marker", function()
			env:OfferQuest(NEW, NEW_TITLE)
			local text = QuestInfoTitleHeader:GetText()
			local markup = "|TInterface\\AddOns\\ForeverQuestMarker\\Media\\Badges.tga:16:16:0:0:128:32:0:32:0:32|t "
			assert.are.equal(markup .. NEW_TITLE, text)
		end)

		it("leaves Classic titles untouched and clears a previous marker", function()
			env:OfferQuest(NEW, NEW_TITLE)
			env:OfferQuest(CLASSIC, "Wanted: Hogger")
			assert.are.equal("Wanted: Hogger", QuestInfoTitleHeader:GetText())
		end)

		it("never stacks markers when the display hook runs twice", function()
			env:OfferQuest(NEW, NEW_TITLE)
			local first = QuestInfoTitleHeader:GetText()
			ns.Integrations.RefreshAll()
			QuestInfo_Display(QUEST_TEMPLATE_REWARD, env.detailChild)
			assert.are.equal(first, QuestInfoTitleHeader:GetText())
		end)

		it("does not stack markers or tags when another addon rewrites the title", function()
			ns.db.settings.textTags = true
			env:OfferQuest(NEW, NEW_TITLE)
			-- Another addon post-hooks after us and prefixes the quest level.
			QuestInfoTitleHeader:SetText("[17] " .. QuestInfoTitleHeader:GetText())
			ns.Integrations.RefreshAll()
			local text = QuestInfoTitleHeader:GetText()
			local _, markers = text:gsub("|T", "")
			local _, tags = text:gsub("|cffe6c067New|r", "")
			assert.are.equal(1, markers)
			assert.are.equal(1, tags)
			assert.is_truthy(text:find("[17] " .. NEW_TITLE, 1, true))
		end)

		it("uses the hollow cell for likely new quests", function()
			env:OfferQuest(LIKELY, "Mystery")
			assert.is_truthy(QuestInfoTitleHeader:GetText():find(":32:64:0:32|t Mystery$"))
		end)

		it("adds a text tag when enabled", function()
			ns.db.settings.textTags = true
			env:OfferQuest(NEW, NEW_TITLE)
			assert.is_truthy(QuestInfoTitleHeader:GetText():find("|t |cffe6c067New|r " .. NEW_TITLE .. "$"))
		end)

		it("marks quest details opened from the map using the selected quest", function()
			env.currentQuestID = CLASSIC
			env:ShowMapDetails(NEW, NEW_TITLE)
			assert.is_truthy(QuestInfoTitleHeader:GetText():find(NEW_TITLE .. "$"))
			assert.is_truthy(QuestInfoTitleHeader:GetText():find("^|T"))
		end)

		it("marks the progress page title", function()
			env:ShowProgress(NEW, NEW_TITLE)
			assert.is_truthy(QuestProgressTitleText:GetText():find("^|T.-|t " .. NEW_TITLE .. "$"))
		end)

		it("explains the marker on hover", function()
			env:OfferQuest(NEW, NEW_TITLE)
			local hover = wow.FindWidgets(function(widget)
				return widget._type == "Frame" and widget.questID == NEW
			end)[1]
			assert.is_table(hover)
			assert.is_true(hover:IsShown())
			wow.FireScript(hover, "OnEnter")
			assert.is_true(GameTooltip:IsOwned(hover))
			assert.is_true(TooltipHas(ns.L.STATE_CONFIRMED))
			wow.FireScript(hover, "OnLeave")
			assert.is_false(GameTooltip:IsShown())
		end)

		it("removes markers from a visible title when the setting is turned off", function()
			env:OfferQuest(NEW, NEW_TITLE)
			env.settings.ForeverQuestMarker_markQuestFrame:SetValue(false)
			assert.are.equal(NEW_TITLE, QuestInfoTitleHeader:GetText())
		end)
	end)

	describe("gossip", function()
		local function FrameFor(questID)
			for _, frame in ipairs(env.gossipScrollBox.frames) do
				local info = frame.elementData.info
				if info and info.questID == questID then
					return frame
				end
			end
		end

		it("puts a pip on new quests only", function()
			env:ShowGossip(
				{ { questID = NEW, title = NEW_TITLE }, { questID = CLASSIC, title = "Wanted: Hogger" } },
				{ { questID = LIKELY, title = "Mystery" } },
				{ { name = "Train me", orderIndex = 1 } }
			)
			assert.is_true(ns.Badge.IsShownOn(FrameFor(NEW)))
			assert.is_true(ns.Badge.IsShownOn(FrameFor(LIKELY)))
			assert.is_false(ns.Badge.IsShownOn(FrameFor(CLASSIC)))
			for _, frame in ipairs(env.gossipScrollBox.frames) do
				if frame.elementData.buttonType == GOSSIP_BUTTON_TYPE_OPTION then
					assert.is_false(ns.Badge.IsShownOn(frame))
				end
			end
		end)

		it("anchors the pip to the quest icon corner", function()
			env:ShowGossip({ { questID = NEW, title = NEW_TITLE } })
			local frame = FrameFor(NEW)
			local texture = wow.FindBadge(frame)
			local point, relativeTo, relativePoint = texture:GetPoint(1)
			assert.are.equal("CENTER", point)
			assert.are.equal(frame.Icon, relativeTo)
			assert.are.equal("BOTTOMRIGHT", relativePoint)
			assert.are.same({ 0, 0.25, 0, 1 }, texture._texCoord)
		end)

		it("clears the pip when a pooled row is reused for another row", function()
			env:ShowGossip({ { questID = NEW, title = NEW_TITLE } })
			local marked = FrameFor(NEW)
			-- Two rows again, so the pool hands back both frames in some order.
			env:ShowGossip({ { questID = CLASSIC, title = "Wanted: Hogger" } })
			local reused = false
			for _, frame in ipairs(env.gossipScrollBox.frames) do
				reused = reused or frame == marked
				assert.is_false(ns.Badge.IsShownOn(frame))
			end
			assert.is_true(reused)
		end)

		it("explains the pip when hovering the row", function()
			env:ShowGossip({ { questID = NEW, title = NEW_TITLE } })
			local frame = FrameFor(NEW)
			wow.FireScript(frame, "OnEnter")
			assert.is_true(TooltipHas(ns.L.STATE_CONFIRMED))
			wow.FireScript(frame, "OnLeave")
			assert.is_false(GameTooltip:IsShown())
		end)

		it("updates open windows when a setting changes", function()
			env:ShowGossip({ { questID = NEW, title = NEW_TITLE } })
			env.settings.ForeverQuestMarker_markGossip:SetValue(false)
			assert.is_false(ns.Badge.IsShownOn(FrameFor(NEW)))
			env.settings.ForeverQuestMarker_markGossip:SetValue(true)
			assert.is_true(ns.Badge.IsShownOn(FrameFor(NEW)))
		end)
	end)

	describe("quest greeting", function()
		local function Rows()
			local rows = {}
			for button in QuestFrameGreetingPanel.titleButtonPool:EnumerateActive() do
				rows[button:GetText()] = button
			end
			return rows
		end

		it("marks available and active quests", function()
			env:ShowGreeting(
				{ { questID = NEW, title = NEW_TITLE }, { questID = CLASSIC, title = "Wanted: Hogger" } },
				{ { questID = SOD, title = "Stalk With The Earthmother" } }
			)
			local rows = Rows()
			assert.is_true(ns.Badge.IsShownOn(rows[NEW_TITLE]))
			assert.is_true(ns.Badge.IsShownOn(rows["Stalk With The Earthmother"]))
			assert.is_false(ns.Badge.IsShownOn(rows["Wanted: Hogger"]))
		end)

		it("stays correct when QUEST_LOG_UPDATE rebuilds the page through the global", function()
			env:ShowGreeting({ { questID = NEW, title = NEW_TITLE } })
			env.greeting.available = { { questID = CLASSIC, title = "Wanted: Hogger" } }
			env:RefreshGreetingFromQuestLog()
			assert.is_false(ns.Badge.IsShownOn(Rows()["Wanted: Hogger"]))
		end)
	end)

	describe("quest log", function()
		before_each(function()
			env.questLog = {
				{ isHeader = true, title = "Elwynn Forest", questID = 0 },
				{ questID = NEW, title = NEW_TITLE, level = 17, difficultyLevel = 17, questLogIndex = 2 },
				{ questID = CLASSIC, title = "Wanted: Hogger", level = 11, difficultyLevel = 11, questLogIndex = 3 },
			}
			QuestLogQuests_Update()
		end)

		local function Buttons()
			local buttons = {}
			for button in QuestScrollFrame.titleFramePool:EnumerateActive() do
				buttons[button.questID] = button
			end
			return buttons
		end

		it("puts a pip on the POI button of new quests only", function()
			local buttons = Buttons()
			assert.is_true(ns.Badge.IsShownOn(buttons[NEW]))
			assert.is_false(ns.Badge.IsShownOn(buttons[CLASSIC]))

			local poiButton = QuestScrollFrame.Contents:FindButtonByQuestID(NEW)
			local texture = wow.FindBadge(buttons[NEW])
			local point, relativeTo, relativePoint = texture:GetPoint(1)
			assert.are.same({ "CENTER", poiButton, "BOTTOMRIGHT" }, { point, relativeTo, relativePoint })
			-- Title and POI buttons are siblings; the pip's holder must draw above the POI.
			assert.is_true(texture:GetParent():GetFrameLevel() > poiButton:GetFrameLevel())
		end)

		it("falls back to the title indent when POI buttons are off", function()
			env.questPOI = false
			QuestLogQuests_Update()
			local button = Buttons()[NEW]
			local _, relativeTo, relativePoint = wow.FindBadge(button):GetPoint(1)
			assert.are.equal(button.Text, relativeTo)
			assert.are.equal("TOPLEFT", relativePoint)
		end)

		it("adds the state to Blizzard's title tooltip", function()
			env:HoverQuestLogButton(Buttons()[NEW])
			assert.is_true(TooltipHas(NEW_TITLE))
			assert.is_true(TooltipHas(ns.L.STATE_CONFIRMED))
		end)
	end)

	describe("objective tracker", function()
		before_each(function()
			env.questTitles[NEW] = NEW_TITLE
			env.questTitles[CLASSIC] = "Wanted: Hogger"
			env.tracked = { NEW, CLASSIC }
			QuestObjectiveTracker:Update()
		end)

		it("puts a pip on the POI button of tracked new quests", function()
			local blocks = QuestObjectiveTracker.usedBlocks.ObjectiveTrackerQuestPOIBlockTemplate
			assert.is_true(ns.Badge.IsShownOn(blocks[NEW]))
			assert.is_false(ns.Badge.IsShownOn(blocks[CLASSIC]))
			local texture = wow.FindBadge(blocks[NEW])
			local _, relativeTo = texture:GetPoint(1)
			assert.are.equal(blocks[NEW].poiButton, relativeTo)
			assert.is_true(texture:GetParent():GetFrameLevel() > blocks[NEW].poiButton:GetFrameLevel())
		end)

		it("keeps the pip out of the header text when the tracker shows no POI buttons", function()
			env.trackerPOI = false
			QuestObjectiveTracker:Update()
			local block = QuestObjectiveTracker.usedBlocks.ObjectiveTrackerQuestPOIBlockTemplate[NEW]
			local point, relativeTo, relativePoint = wow.FindBadge(block):GetPoint(1)
			assert.are.same({ "TOPRIGHT", block.HeaderText, "TOPLEFT" }, { point, relativeTo, relativePoint })
		end)

		it("shows its own tooltip outside groups", function()
			local block = QuestObjectiveTracker.usedBlocks.ObjectiveTrackerQuestPOIBlockTemplate[NEW]
			env:HoverTrackerBlock(block, false)
			assert.is_true(GameTooltip:IsOwned(block))
			assert.is_true(TooltipHas(NEW_TITLE))
			assert.is_true(TooltipHas(ns.L.STATE_CONFIRMED))
		end)

		it("extends Blizzard's party tooltip in groups", function()
			local block = QuestObjectiveTracker.usedBlocks.ObjectiveTrackerQuestPOIBlockTemplate[NEW]
			GameTooltip:SetOwner(block, "ANCHOR_PRESERVE")
			GameTooltip:AddLine("Party progress")
			env:HoverTrackerBlock(block, true)
			assert.is_true(TooltipHas("Party progress"))
			assert.is_true(TooltipHas(ns.L.STATE_CONFIRMED))
		end)
	end)

	describe("tooltips", function()
		it("describes quest links", function()
			env:ShowTooltipForQuest(NEW)
			assert.is_true(TooltipHas(ns.L.STATE_CONFIRMED))
			env:ShowTooltipForQuest(CLASSIC)
			assert.are.equal(0, #GameTooltip.lines)
		end)

		it("describes world map quest pins", function()
			local pin = CreateFrame("Frame")
			GameTooltip:SetOwner(pin, "ANCHOR_RIGHT")
			EventRegistry:TriggerEvent("MapCanvas.QuestPin.OnEnter", pin, NEW)
			assert.is_true(TooltipHas(ns.L.STATE_CONFIRMED))
		end)
	end)

	describe("chat notices", function()
		it("reports the quest in chat when another addon hides the quest window", function()
			env.currentQuestID, env.currentQuestTitle = NEW, NEW_TITLE
			QuestFrame:Hide()
			env:FireEvent("QUEST_DETAIL", 0)
			env:RunTimers()
			assert.is_true(Printed(env, NEW_TITLE))
		end)

		it("stays quiet when the quest window is shown", function()
			env.currentQuestID, env.currentQuestTitle = NEW, NEW_TITLE
			QuestFrame:Show()
			env:FireEvent("QUEST_DETAIL", 0)
			env:RunTimers()
			assert.is_false(Printed(env, NEW_TITLE))
		end)

		it("announces every new quest once when asked to", function()
			ns.db.settings.chatAnnounce = true
			env.currentQuestID, env.currentQuestTitle = NEW, NEW_TITLE
			QuestFrame:Show()
			env:FireEvent("QUEST_DETAIL", 0)
			env:FireEvent("QUEST_DETAIL", 0)
			local count = 0
			for _, line in ipairs(env.printed) do
				if line:find(NEW_TITLE, 1, true) then
					count = count + 1
				end
			end
			assert.are.equal(1, count)
		end)
	end)

	describe("slash commands", function()
		local function Run(input)
			SlashCmdList.FOREVERQUESTMARKER(input)
		end

		it("opens the settings", function()
			Run("")
			assert.are.same({ ns.L.ADDON_TITLE }, env.settings.opened)
		end)

		it("explains a quest's classification", function()
			env.questTitles[NEW] = NEW_TITLE
			Run("check " .. NEW)
			assert.is_true(Printed(env, "Quest 92401 Into the Ruins: New in WoW Forever"))
			Run("check nothing")
			assert.is_true(Printed(env, "Usage: /fqm check"))
		end)

		it("prints status, probe, errors and help without failing", function()
			env:OfferQuest(NEW, NEW_TITLE)
			env:ShowGossip({ { questID = NEW, title = NEW_TITLE } })
			Run("status")
			Run("probe")
			Run("errors")
			Run("help")
			assert.is_true(Printed(env, "Integrations:"))
			assert.is_true(Printed(env, "Gossip 92401"))
			assert.is_true(Printed(env, "badge shown"))
			assert.is_true(Printed(env, "No errors recorded"))
		end)

		it("tunes marker placement live and resets it", function()
			env:ShowGossip({ { questID = NEW, title = NEW_TITLE } })
			Run("tune gossip size 18")
			assert.are.equal(18, ns.Badge.GetLayout("gossip").size)
			Run("tune gossip nonsense 1")
			assert.is_true(Printed(env, "Usage: /fqm tune"))
			Run("tune reset")
			assert.are.equal(ns.Badge.DEFAULT_LAYOUT.gossip.size, ns.Badge.GetLayout("gossip").size)
		end)

		it("rounds tuned values to whole pixels", function()
			Run("tune title y 1.6")
			assert.are.equal(2, ns.Badge.GetLayout("title").y)
		end)

		it("toggles debug output", function()
			Run("debug")
			assert.is_true(ns.db.settings.debug)
			Run("debug")
			assert.is_false(ns.db.settings.debug)
		end)

		it("asks for confirmation before deleting recorded quests", function()
			ns.Recorder.Observe(NEW, "detail", { title = NEW_TITLE })
			Run("reset recorder")
			assert.are.equal(1, ns.Recorder.Count())
			Run("reset recorder confirm")
			assert.are.equal(0, ns.Recorder.Count())
		end)

		it("opens the export window", function()
			Run("export")
			assert.is_true(Printed(env, "No quests recorded yet"))
			ns.Recorder.Observe(NEW, "detail", { title = NEW_TITLE })
			Run("export")
			local window = ForeverQuestMarkerExportFrame
			assert.is_true(window:IsShown())
			assert.is_truthy(window.Hint:GetText():find(ns.Export.SUBMIT_URL, 1, true))
			assert.is_truthy(window.EditBox:GetText():find('"id":92401', 1, true))
			Run("export CSV")
			assert.is_truthy(window.EditBox:GetText():find("^id,title,state"))
			-- Typing into the box restores the export.
			window.EditBox:SetText("oops")
			wow.FireScript(window.EditBox, "OnTextChanged", true)
			assert.is_truthy(window.EditBox:GetText():find("^id,title,state"))
		end)

		it("rejects unknown commands", function()
			Run("frobnicate")
			assert.is_true(Printed(env, "Unknown command 'frobnicate'"))
		end)
	end)

	describe("error containment", function()
		it("keeps Blizzard's flow running and reports a failing hook once", function()
			local original = ns.Display.GetMarker
			ns.Display.GetMarker = function()
				error("boom")
			end
			env:OfferQuest(NEW, NEW_TITLE)
			env:OfferQuest(NEW, NEW_TITLE)
			ns.Display.GetMarker = original

			assert.are.equal(NEW_TITLE, QuestInfoTitleHeader:GetText())
			assert.are.equal(1, #env.errors)
			assert.is_truthy(env.errors[1]:find("boom"))
			assert.are.equal(1, #ns.db.errors)
			assert.are.equal(2, ns.db.errors[1].count)
			assert.is_true(Printed(env, "hit an error in QuestInfo_Display"))
			env.errors = {}
		end)
	end)
end)
