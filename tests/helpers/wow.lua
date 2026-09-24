-- A strict stand-in for the WoW client used by the specs.
--
-- Widgets only expose methods that exist in the target client's widget API
-- (tests/helpers/widget_api.lua, generated from the client's documentation), so
-- calling a method the client lacks fails the test just as it would error in game.
-- The Blizzard frames and functions the addon hooks are emulated after the
-- client's FrameXML (Gethe/wow-ui-source, forever branch).

local WidgetAPI = require("helpers.widget_api")

local M = {}

-- Widgets ----------------------------------------------------------------------

local Impl = {}

function Impl:Show()
	self._shown = true
end

function Impl:Hide()
	self._shown = false
end

function Impl:SetShown(shown)
	self._shown = not not shown
end

function Impl:IsShown()
	return self._shown
end

function Impl:IsVisible()
	if not self._shown then
		return false
	end
	return self._parent == nil or self._parent:IsVisible()
end

function Impl:SetParent(parent)
	self._parent = parent
end

function Impl:GetParent()
	return self._parent
end

function Impl:SetPoint(point, relativeTo, relativePoint, x, y)
	if type(relativeTo) == "number" then
		relativeTo, relativePoint, x, y = nil, nil, relativeTo, relativePoint
	end
	table.insert(self._points, { point, relativeTo, relativePoint, x or 0, y or 0 })
end

function Impl:ClearAllPoints()
	self._points = {}
end

function Impl:GetNumPoints()
	return #self._points
end

function Impl:GetPoint(index)
	local p = self._points[index or 1]
	if p then
		return p[1], p[2], p[3], p[4], p[5]
	end
end

function Impl:SetSize(width, height)
	self._width, self._height = width, height
end

function Impl:SetWidth(width)
	self._width = width
end

function Impl:SetHeight(height)
	self._height = height
end

function Impl:GetWidth()
	return self._width
end

function Impl:GetHeight()
	return self._height
end

function Impl:GetSize()
	return self._width, self._height
end

function Impl:SetText(text)
	if self._fontString then
		self._fontString:SetText(text)
	else
		self._text = text
	end
end

function Impl:SetFormattedText(format, ...)
	self:SetText(format:format(...))
end

function Impl:GetText()
	if self._fontString then
		return self._fontString:GetText()
	end
	return self._text
end

local function VisibleLength(text)
	local plain = (text or ""):gsub("|T.-|t", "XX"):gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "")
	return #plain
end

function Impl:GetUnboundedStringWidth()
	return VisibleLength(self._text) * 7
end

function Impl:GetStringWidth()
	return math.min(VisibleLength(self._text) * 7, self._width > 0 and self._width or math.huge)
end

function Impl:GetStringHeight()
	return 12
end

function Impl:GetFont()
	return "Fonts\\FRIZQT__.TTF", 12, ""
end

function Impl:GetFontString()
	return self._fontString
end

function Impl:SetID(id)
	self._id = id
end

function Impl:GetID()
	return self._id or 0
end

function Impl:SetTexture(texture)
	self._texture = texture
end

function Impl:GetTexture()
	return self._texture
end

function Impl:SetTexCoord(left, right, top, bottom)
	self._texCoord = { left, right, top, bottom }
end

-- The client returns the four corners: UL, LL, UR, LR.
function Impl:GetTexCoord()
	local left, right, top, bottom = unpack(self._texCoord or { 0, 1, 0, 1 })
	return left, top, left, bottom, right, top, right, bottom
end

function Impl:SetFrameLevel(level)
	self._frameLevel = level
end

-- Like the client, a frame sits one level above its parent unless set explicitly.
function Impl:GetFrameLevel()
	if self._frameLevel then
		return self._frameLevel
	end
	return self._parent and self._parent.GetFrameLevel and self._parent:GetFrameLevel() + 1 or 1
end

function Impl:GetObjectType()
	return self._type
end

function Impl:IsObjectType(objectType)
	return self._type == objectType
end

function Impl:GetName()
	return self._name
end

function Impl:SetScript(scriptType, handler)
	self._scripts[scriptType] = handler
	self._hooks[scriptType] = nil
end

function Impl:GetScript(scriptType)
	return self._scripts[scriptType]
end

function Impl:HookScript(scriptType, handler)
	self._hooks[scriptType] = self._hooks[scriptType] or {}
	table.insert(self._hooks[scriptType], handler)
end

function Impl:RegisterEvent(event)
	self._events = self._events or {}
	self._events[event] = true
	M.eventFrames[self] = true
end

function Impl:UnregisterEvent(event)
	if self._events then
		self._events[event] = nil
	end
end

function Impl:IsEventRegistered(event)
	return self._events ~= nil and self._events[event] == true
end

function Impl:SetScrollChild(child)
	self._scrollChild = child
	child:SetParent(self)
end

function Impl:GetScrollChild()
	return self._scrollChild
end

local NewWidget

function Impl:CreateTexture(name, layer, _template, subLevel)
	local texture = NewWidget("Texture", name, self)
	texture._layer, texture._subLevel = layer, subLevel
	return texture
end

function Impl:CreateFontString(name, _layer, template)
	local fontString = NewWidget("FontString", name, self)
	fontString._template = template
	return fontString
end

local function NoOp() end

local metatables = {}
for widgetType, methods in pairs(WidgetAPI) do
	metatables[widgetType] = {
		__index = function(_, key)
			if methods[key] then
				return Impl[key] or NoOp
			end
			return nil
		end,
	}
end

function NewWidget(widgetType, name, parent)
	assert(metatables[widgetType], "unsupported widget type " .. tostring(widgetType))
	local widget = setmetatable({
		_type = widgetType,
		_name = name,
		_parent = parent,
		_shown = true,
		_points = {},
		_scripts = {},
		_hooks = {},
		_width = 0,
		_height = 0,
	}, metatables[widgetType])
	if widgetType == "Button" then
		widget._fontString = NewWidget("FontString", nil, widget)
	end
	table.insert(M.created, widget)
	if name then
		_G[name] = widget
	end
	return widget
end
M.NewWidget = NewWidget
M.created = {}

--- Widgets created since the last Create(), filtered by a predicate.
function M.FindWidgets(predicate)
	local found = {}
	for _, widget in ipairs(M.created) do
		if predicate(widget) then
			table.insert(found, widget)
		end
	end
	return found
end

--- The marker texture the addon attached to `owner` (it lives on a holder frame).
function M.FindBadge(owner)
	return M.FindWidgets(function(widget)
		return widget._type == "Texture" and widget._parent ~= nil and widget._parent._parent == owner
			and type(widget._texture) == "string" and widget._texture:find("Badges", 1, true) ~= nil
	end)[1]
end

--- Runs a widget script and its hooks the way the client does.
function M.FireScript(widget, scriptType, ...)
	local handler = widget._scripts[scriptType]
	if handler then
		handler(widget, ...)
	end
	for _, hook in ipairs(widget._hooks[scriptType] or {}) do
		hook(widget, ...)
	end
end

-- Templates the addon instantiates; an unknown template is an error, since it
-- would be one in game too.
local TEMPLATES = {
	BasicFrameTemplateWithInset = function(frame)
		frame.TitleText = frame:CreateFontString(nil, "OVERLAY", "GameFontNormal")
		frame.CloseButton = NewWidget("Button", nil, frame)
	end,
	UIPanelScrollFrameTemplate = function(frame)
		frame.ScrollBar = NewWidget("Frame", nil, frame)
	end,
}

local function CreateFrame(frameType, name, parent, template)
	local widget = NewWidget(frameType, name, parent)
	for templateName in (template or ""):gmatch("[^,%s]+") do
		local apply = TEMPLATES[templateName]
		assert(apply, "template not emulated (verify it exists in the client first): " .. templateName)
		apply(widget)
	end
	return widget
end

-- Object pools, as ObjectPoolMixin: EnumerateActive yields the objects as keys.
local function NewPool(create)
	local pool = { active = {}, inactive = {} }
	function pool:Acquire()
		local object = table.remove(self.inactive) or create()
		self.active[object] = true
		object:Show()
		return object
	end
	function pool:ReleaseAll()
		for object in pairs(self.active) do
			object:Hide()
			object:ClearAllPoints()
			table.insert(self.inactive, object)
		end
		self.active = {}
	end
	function pool:EnumerateActive()
		return pairs(self.active)
	end
	function pool:GetNumActive()
		local count = 0
		for _ in pairs(self.active) do
			count = count + 1
		end
		return count
	end
	return pool
end
M.NewPool = NewPool

-- GameTooltip -----------------------------------------------------------------

local function NewTooltip(name)
	local tooltip = { lines = {}, owner = nil, shown = false }
	function tooltip:SetOwner(owner, anchor)
		self.owner, self.anchor, self.lines = owner, anchor, {}
	end
	function tooltip:IsOwned(frame)
		return self.owner == frame
	end
	function tooltip:GetOwner()
		return self.owner
	end
	function tooltip:AddLine(text, r, g, b, wrap)
		table.insert(self.lines, { text = text, r = r, g = g, b = b, wrap = wrap })
	end
	function tooltip:Show()
		self.shown = true
	end
	function tooltip:Hide()
		self.shown, self.owner = false, nil
	end
	function tooltip:IsShown()
		return self.shown
	end
	function tooltip:ClearAllPoints() end
	function tooltip:SetPoint() end
	function tooltip:NumLines()
		return #self.lines
	end
	function tooltip:IsForbidden()
		return false
	end
	_G[name] = tooltip
	return tooltip
end

-- Environment -----------------------------------------------------------------

local function strsplit(delimiter, text)
	local parts = {}
	for part in (text .. delimiter):gmatch("(.-)" .. delimiter:gsub("%p", "%%%0")) do
		table.insert(parts, part)
	end
	return unpack(parts)
end

local function Hooksecurefunc(target, name, hook)
	if type(target) == "string" then
		target, name, hook = _G, target, name
	end
	local original = target[name]
	assert(type(original) == "function", "hooksecurefunc target missing: " .. tostring(name))
	target[name] = function(...)
		local results = { original(...) }
		hook(...)
		return unpack(results)
	end
end

local function NewCallbackRegistry()
	local registry = { callbacks = {} }
	function registry:RegisterCallback(event, func, owner)
		assert(type(func) == "function")
		self.callbacks[event] = self.callbacks[event] or {}
		self.callbacks[event][owner or func] = func
		return owner
	end
	function registry:TriggerEvent(event, ...)
		for owner, func in pairs(self.callbacks[event] or {}) do
			func(owner, ...)
		end
	end
	return registry
end

--- Installs a fresh client emulation into _G and returns a controller for specs.
function M.Create()
	local env = {
		printed = {},
		errors = {},
		timers = {},
		loadedAddOns = { Blizzard_ObjectiveTracker = true },
		units = {},
		questTitles = {},
		questLevels = {},
		questLog = {},
		gossip = { available = {}, active = {} },
		greeting = { available = {}, active = {} },
		tracked = {},
		currentQuestID = 0,
		currentQuestTitle = nil,
		selectedQuestID = 0,
		combat = false,
		secret = {},
		addOnVersion = "@project-version@",
		position = { 0.45216, 0.61234 },
		questPOI = true,
		trackerPOI = true,
		autoQuestPopUps = {},
		settings = { categories = {}, checkboxes = {}, initializers = {}, opened = {} },
		postCalls = {},
	}

	M.eventFrames = {}
	M.created = {}
	_G.ForeverQuestMarkerDB = nil
	_G.print = function(...)
		local parts = {}
		for i = 1, select("#", ...) do
			parts[i] = tostring((select(i, ...)))
		end
		table.insert(env.printed, table.concat(parts, " "))
	end
	_G.time = os.time
	_G.debugstack = nil
	_G.geterrorhandler = function()
		return function(message)
			table.insert(env.errors, message)
		end
	end
	_G.strsplit = strsplit
	_G.hooksecurefunc = Hooksecurefunc
	_G.issecretvalue = function(value)
		return env.secret[value] == true
	end
	_G.InCombatLockdown = function()
		return env.combat
	end
	_G.CreateFrame = CreateFrame
	_G.UIParent = NewWidget("Frame", "UIParent")
	_G.SlashCmdList = {}
	for _, font in ipairs({ "GameFontNormal", "GameFontHighlightSmall", "GameFontNormalSmall", "ChatFontNormal" }) do
		_G[font] = { name = font }
	end

	_G.C_Timer = {
		After = function(_delay, callback)
			table.insert(env.timers, callback)
		end,
	}
	_G.C_AddOns = {
		GetAddOnMetadata = function(_name, field)
			if field == "Version" then
				return env.addOnVersion
			end
		end,
		IsAddOnLoaded = function(name)
			local loaded = env.loadedAddOns[name] == true
			return loaded, loaded
		end,
	}
	_G.GetBuildInfo = function()
		return "1.60.1", "69977", "Sep 22 2026", 16001
	end
	_G.GetLocale = function()
		return "enUS"
	end
	_G.UnitGUID = function(unit)
		return env.units[unit] and env.units[unit].guid
	end
	_G.UnitName = function(unit)
		return env.units[unit] and env.units[unit].name
	end
	_G.UnitFactionGroup = function()
		return "Alliance", "Alliance"
	end
	_G.C_Map = {
		GetBestMapForUnit = function()
			return 1429
		end,
		GetPlayerMapPosition = function()
			if not env.position then
				return nil
			end
			return {
				GetXY = function()
					return env.position[1], env.position[2]
				end,
			}
		end,
	}
	_G.C_QuestLog = {
		GetSelectedQuest = function()
			return env.selectedQuestID
		end,
		GetTitleForQuestID = function(questID)
			return env.questTitles[questID]
		end,
		GetQuestDifficultyLevel = function(questID)
			return env.questLevels[questID] or 0
		end,
		RequestLoadQuestByID = function() end,
		GetNumQuestLogEntries = function()
			return #env.questLog, #env.questLog
		end,
		GetInfo = function(index)
			return env.questLog[index]
		end,
		GetLogIndexForQuestID = function(questID)
			for index, info in ipairs(env.questLog) do
				if info.questID == questID then
					return index
				end
			end
			return nil
		end,
	}
	_G.C_GossipInfo = {
		GetAvailableQuests = function()
			return env.gossip.available
		end,
		GetActiveQuests = function()
			return env.gossip.active
		end,
	}
	_G.GetQuestID = function()
		return env.currentQuestID
	end
	_G.GetTitleText = function()
		return env.currentQuestTitle
	end
	_G.GetNumAvailableQuests = function()
		return #env.greeting.available
	end
	_G.GetNumActiveQuests = function()
		return #env.greeting.active
	end
	_G.GetAvailableTitle = function(index)
		return env.greeting.available[index].title
	end
	_G.GetActiveTitle = function(index)
		return env.greeting.active[index].title, false
	end
	_G.GetActiveQuestID = function(index)
		return env.greeting.active[index].questID
	end
	_G.GetAvailableQuestInfo = function(index)
		return false, 0, false, false, env.greeting.available[index].questID, false, false, 0
	end

	_G.GameTooltip = NewTooltip("GameTooltip")
	_G.EventRegistry = NewCallbackRegistry()
	_G.Enum = { TooltipDataType = { Quest = 23 } }
	_G.TooltipDataProcessor = {
		AddTooltipPostCall = function(tooltipType, func)
			env.postCalls[tooltipType] = env.postCalls[tooltipType] or {}
			table.insert(env.postCalls[tooltipType], func)
		end,
	}

	M.InstallSettings(env)
	M.InstallQuestFrame(env)
	M.InstallGossip(env)
	M.InstallQuestLog(env)
	M.InstallTracker(env)

	--- Delivers a game event to every frame registered for it.
	function env:FireEvent(event, ...)
		for frame in pairs(M.eventFrames) do
			if frame._events[event] and frame._scripts.OnEvent then
				frame._scripts.OnEvent(frame, event, ...)
			end
		end
	end

	function env:RunTimers()
		local pending = self.timers
		self.timers = {}
		for _, callback in ipairs(pending) do
			callback()
		end
	end

	function env:ShowTooltipForQuest(questID)
		GameTooltip:SetOwner(UIParent, "ANCHOR_CURSOR")
		for _, func in ipairs(self.postCalls[Enum.TooltipDataType.Quest] or {}) do
			func(GameTooltip, { type = Enum.TooltipDataType.Quest, id = questID })
		end
		return GameTooltip.lines
	end

	return env
end

-- Settings panel -------------------------------------------------------------

function M.InstallSettings(env)
	local settings = env.settings
	_G.Settings = {
		VarType = { Boolean = "boolean", Number = "number", String = "string" },
		Default = { True = true, False = false },
		RegisterVerticalLayoutCategory = function(name)
			local category = { name = name }
			function category:GetID()
				return name
			end
			local layout = {}
			function layout:AddInitializer(initializer)
				table.insert(settings.initializers, initializer)
			end
			table.insert(settings.categories, category)
			return category, layout
		end,
		RegisterAddOnSetting = function(_category, variable, key, tbl, varType, name, default)
			assert(type(variable) == "string" and type(key) == "string" and type(tbl) == "table")
			assert(type(default) == varType, "default type mismatch for " .. variable)
			if tbl[key] == nil then
				tbl[key] = default
			end
			local setting = { variable = variable, key = key, name = name }
			function setting:GetValue()
				return tbl[key]
			end
			function setting:SetValue(value)
				tbl[key] = value
				if self.callback then
					self.callback(self, value)
				end
			end
			function setting:SetValueChangedCallback(callback)
				self.callback = callback
			end
			settings[variable] = setting
			return setting
		end,
		CreateCheckbox = function(_category, setting, tooltip)
			assert(type(tooltip) == "string" and tooltip ~= "", "checkbox without tooltip")
			table.insert(settings.checkboxes, setting)
			table.insert(settings.initializers, { kind = "checkbox", setting = setting })
		end,
		RegisterAddOnCategory = function(category)
			settings.registered = category
		end,
		OpenToCategory = function(id)
			table.insert(settings.opened, id)
		end,
	}
	_G.CreateSettingsListSectionHeaderInitializer = function(name)
		return { kind = "header", name = name }
	end
	_G.CreateSettingsButtonInitializer = function(name, buttonText, onClick)
		return { kind = "button", name = name, buttonText = buttonText, onClick = onClick }
	end
end

-- Quest window (Mainline QuestFrame.lua / QuestInfo.lua) ----------------------

function M.InstallQuestFrame(env)
	_G.QuestFrame = NewWidget("Frame", "QuestFrame", UIParent)
	_G.QuestFrame:Hide()
	local detailChild = NewWidget("Frame", "QuestDetailScrollChildFrame", QuestFrame)
	local mapChild = NewWidget("Frame", "QuestMapDetailsScrollChildFrame", UIParent)
	local header = detailChild:CreateFontString("QuestInfoTitleHeader", "ARTWORK", "QuestTitleFont")

	_G.QUEST_TEMPLATE_DETAIL = { questLog = nil }
	_G.QUEST_TEMPLATE_REWARD = { questLog = nil, chooseItems = true }
	_G.QUEST_TEMPLATE_MAP_DETAILS = { questLog = true }

	-- Emulates the part of QuestInfo_Display the addon depends on: the title header
	-- is reparented to the page and receives a fresh title.
	_G.QuestInfo_Display = function(template, parentFrame)
		header:SetParent(parentFrame)
		if template.questLog then
			header:SetText(env.questTitles[env.selectedQuestID])
		else
			header:SetText(env.currentQuestTitle)
		end
	end
	env.detailChild, env.mapChild = detailChild, mapChild

	local progressPanel = NewWidget("Frame", "QuestFrameProgressPanel", QuestFrame)
	local progressTitle = progressPanel:CreateFontString("QuestProgressTitleText", "ARTWORK", "QuestTitleFont")
	-- XML binds OnShow to the function value.
	progressPanel:SetScript("OnShow", function()
		progressTitle:SetText(GetTitleText())
	end)

	local greeting = NewWidget("Frame", "QuestFrameGreetingPanel", QuestFrame)
	greeting.titleButtonPool = NewPool(function()
		local button = NewWidget("Button", nil, greeting)
		button.Icon = button:CreateTexture(nil, "BACKGROUND")
		return button
	end)
	local function GreetingOnShow()
		greeting.titleButtonPool:ReleaseAll()
		for i, quest in ipairs(env.greeting.active) do
			local button = greeting.titleButtonPool:Acquire()
			button:SetFormattedText("%s", quest.title)
			button:SetID(i)
			button.isActive = 1
		end
		for i, quest in ipairs(env.greeting.available) do
			local button = greeting.titleButtonPool:Acquire()
			button:SetFormattedText("%s", quest.title)
			button:SetID(i)
			button.isActive = 0
		end
	end
	_G.QuestFrameGreetingPanel_OnShow = GreetingOnShow
	greeting:SetScript("OnShow", GreetingOnShow)

	--- Opens the quest window on a quest's offer page, like QUEST_DETAIL does.
	function env:OfferQuest(questID, title)
		self.currentQuestID, self.currentQuestTitle = questID, title
		QuestFrame:Show()
		QuestInfo_Display(QUEST_TEMPLATE_DETAIL, detailChild)
	end

	function env:ShowProgress(questID, title)
		self.currentQuestID, self.currentQuestTitle = questID, title
		QuestFrame:Show()
		M.FireScript(progressPanel, "OnShow")
	end

	function env:ShowMapDetails(questID, title)
		self.selectedQuestID = questID
		self.questTitles[questID] = title
		QuestInfo_Display(QUEST_TEMPLATE_MAP_DETAILS, mapChild)
	end

	function env:ShowGreeting(available, active)
		self.greeting.available, self.greeting.active = available or {}, active or {}
		QuestFrame:Show()
		greeting:Show()
		M.FireScript(greeting, "OnShow")
	end

	--- QUEST_LOG_UPDATE while the greeting is open calls the global directly.
	function env:RefreshGreetingFromQuestLog()
		QuestFrameGreetingPanel_OnShow(greeting)
	end
end

-- Gossip (Shared/GossipFrameShared.lua, Mainline/GossipFrame.lua) -------------

function M.InstallGossip(env)
	_G.GOSSIP_BUTTON_TYPE_TITLE = 1
	_G.GOSSIP_BUTTON_TYPE_DIVIDER = 2
	_G.GOSSIP_BUTTON_TYPE_OPTION = 3
	_G.GOSSIP_BUTTON_TYPE_ACTIVE_QUEST = 4
	_G.GOSSIP_BUTTON_TYPE_AVAILABLE_QUEST = 5

	local gossipFrame = NewWidget("Frame", "GossipFrame", UIParent)
	gossipFrame:Hide()
	local scrollBox = NewWidget("Frame", nil, gossipFrame)
	scrollBox.frames = {}
	scrollBox.callbacks = { initialized = {}, released = {} }
	gossipFrame.GreetingPanel = { ScrollBox = scrollBox }

	function scrollBox:ForEachFrame(func)
		for _, frame in ipairs(self.frames) do
			local result = func(frame, frame.elementData)
			if result then
				return result
			end
		end
	end

	function scrollBox:RegisterCallback(event, callback, owner)
		assert(type(owner) ~= "number", "owner as number is reserved")
		table.insert(self.callbacks[event], { callback = callback, owner = owner })
	end

	_G.ScrollBoxListMixin = { Event = { OnInitializedFrame = "initialized", OnReleasedFrame = "released" } }
	_G.ScrollUtil = {
		-- Mirrors Blizzard, including handing ForEachFrame's (frame, elementData)
		-- to the callback when iterateExisting is set.
		AddInitializedFrameCallback = function(box, callback, owner, iterateExisting)
			if iterateExisting then
				box:ForEachFrame(callback)
			end
			box:RegisterCallback(ScrollBoxListMixin.Event.OnInitializedFrame, function(o, frame, elementData)
				callback(o, frame, elementData)
			end, owner)
		end,
		AddReleasedFrameCallback = function(box, callback, owner)
			box:RegisterCallback(ScrollBoxListMixin.Event.OnReleasedFrame, callback, owner)
		end,
	}

	local pool = NewPool(function()
		local button = NewWidget("Button", nil, scrollBox)
		button.Icon = button:CreateTexture(nil, "BACKGROUND")
		return button
	end)

	-- Emulates GossipFrameSharedMixin:Update and the ScrollBox view: frames are
	-- released, re-acquired (possibly for a different row) and initialized.
	function gossipFrame:Update()
		for _, frame in ipairs(scrollBox.frames) do
			for _, entry in ipairs(scrollBox.callbacks.released) do
				entry.callback(entry.owner, frame, frame.elementData)
			end
		end
		pool:ReleaseAll()
		scrollBox.frames = {}
		local rows = { { buttonType = GOSSIP_BUTTON_TYPE_TITLE, text = "Greetings" } }
		for _, info in ipairs(env.gossip.available) do
			table.insert(rows, { buttonType = GOSSIP_BUTTON_TYPE_AVAILABLE_QUEST, info = info })
		end
		for _, info in ipairs(env.gossip.active) do
			table.insert(rows, { buttonType = GOSSIP_BUTTON_TYPE_ACTIVE_QUEST, info = info })
		end
		for _, option in ipairs(env.gossip.options or {}) do
			table.insert(rows, { buttonType = GOSSIP_BUTTON_TYPE_OPTION, info = option })
		end
		for _, elementData in ipairs(rows) do
			local frame = pool:Acquire()
			frame.elementData = elementData
			if elementData.info then
				frame:SetID(elementData.info.questID or elementData.info.orderIndex or 0)
				frame:SetText(elementData.info.title or elementData.info.name)
			end
			table.insert(scrollBox.frames, frame)
			for _, entry in ipairs(scrollBox.callbacks.initialized) do
				entry.callback(entry.owner, frame, elementData)
			end
		end
	end

	function env:ShowGossip(available, active, options)
		self.gossip.available, self.gossip.active, self.gossip.options = available or {}, active or {}, options
		gossipFrame:Show()
		gossipFrame:Update()
	end

	env.gossipScrollBox = scrollBox
end

-- Quest log (Mainline/QuestMapFrame.lua) ---------------------------------------

function M.InstallQuestLog(env)
	local questScrollFrame = NewWidget("Frame", "QuestScrollFrame", UIParent)
	local contents = NewWidget("Frame", nil, questScrollFrame)
	questScrollFrame.Contents = contents
	questScrollFrame.titleFramePool = NewPool(function()
		local button = NewWidget("Button", nil, contents)
		button.Text = button:CreateFontString(nil, "ARTWORK", "GameFontNormalLeft")
		return button
	end)
	-- POIButtonOwnerMixin on Contents; its buttons are siblings of the title buttons.
	contents.buttonPool = NewPool(function()
		return NewWidget("Button", nil, contents)
	end)
	function contents:FindButtonByQuestID(questID)
		for poiButton in self.buttonPool:EnumerateActive() do
			if poiButton.questID == questID then
				return poiButton
			end
		end
	end

	_G.QuestLogQuests_Update = function()
		questScrollFrame.titleFramePool:ReleaseAll()
		contents.buttonPool:ReleaseAll()
		for _, info in ipairs(env.questLog) do
			if not info.isHeader then
				local button = questScrollFrame.titleFramePool:Acquire()
				button.info, button.questID, button.questLogIndex = info, info.questID, info.questLogIndex
				button.Text:SetText(("[%d] %s"):format(info.difficultyLevel or info.level or 1, info.title))
				-- QuestLogQuests_AddQuestButton: one POI button per quest while the questPOI CVar is on.
				if env.questPOI then
					local poiButton = contents.buttonPool:Acquire()
					poiButton.questID = info.questID
					poiButton:SetPoint("TOPLEFT", button, 6, -4)
				end
			end
		end
	end

	--- Emulates hovering a quest log title: Blizzard shows its tooltip, then fires the event.
	function env:HoverQuestLogButton(button)
		GameTooltip:SetOwner(button, "ANCHOR_RIGHT")
		GameTooltip:AddLine(button.info.title)
		GameTooltip:Show()
		EventRegistry:TriggerEvent("QuestMapLogTitleButton.OnEnter", button, button.questID)
	end
end

-- Objective tracker (Blizzard_ObjectiveTracker) --------------------------------

function M.InstallTracker(env)
	local module = NewWidget("Frame", "QuestObjectiveTracker", UIParent)
	module.usedBlocks = { ObjectiveTrackerQuestPOIBlockTemplate = {} }
	local pool = NewPool(function()
		local block = NewWidget("Frame", nil, module)
		block.HeaderText = block:CreateFontString(nil, "ARTWORK", "ObjectiveTrackerLineFont")
		block.HeaderText:SetWidth(220)
		return block
	end)

	function module:EnumerateActiveBlocks(callback)
		for _, blocks in pairs(self.usedBlocks) do
			for _, block in pairs(blocks) do
				callback(block)
			end
		end
	end

	function module:Update()
		local blocks = self.usedBlocks.ObjectiveTrackerQuestPOIBlockTemplate
		for id, block in pairs(blocks) do
			block.HeaderText:SetText("")
			block:Hide()
			pool.active[block] = nil
			table.insert(pool.inactive, block)
			blocks[id] = nil
		end
		for _, questID in ipairs(env.tracked) do
			local block = pool:Acquire()
			block.id = questID
			block.HeaderText:SetText(env.questTitles[questID] or ("Quest " .. questID))
			-- ObjectiveTrackerQuestPOIBlockMixin:AddPOIButton, left of the header.
			if env.trackerPOI then
				block.poiButton = block.poiButton or NewWidget("Button", nil, block)
				block.poiButton:ClearAllPoints()
				block.poiButton:SetPoint("TOPRIGHT", block.HeaderText, "TOPLEFT", -7, 5)
				block.poiButton:Show()
			elseif block.poiButton then
				block.poiButton:Hide()
				block.poiButton = nil
			end
			blocks[questID] = block
		end
		return 0, false
	end

	function module:AddAutoQuestPopUp(questID, popUpType, itemID)
		table.insert(env.autoQuestPopUps, { questID = questID, popUpType = popUpType, itemID = itemID })
	end

	--- QUEST_DETAIL for a quest started from an item: QuestFrame_OnEvent queues an
	--- auto quest pop-up and closes the offer before other handlers see the event.
	function env:OfferQuestFromItem(questID, itemID)
		self.currentQuestID = questID
		module:AddAutoQuestPopUp(questID, "OFFER", itemID)
		self.currentQuestID, self.currentQuestTitle = 0, nil
		self:FireEvent("QUEST_DETAIL", itemID)
	end

	function env:HoverTrackerBlock(block, isInGroup)
		EventRegistry:TriggerEvent("OnQuestBlockHeader.OnEnter", block, block.id, isInGroup)
	end
end

return M
