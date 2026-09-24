/**
 * Everything the addon assumes about the client's FrameXML and API, as patterns
 * that must appear in the client's UI source (Gethe/wow-ui-source, forever branch).
 * When Blizzard renames or reshapes one of these, tools/verify-ui-source.ts fails
 * and points at the integration to revisit.
 */

export type SourceKind = "lua" | "xml" | "docs";

export interface ContractCheck {
  id: string;
  /** Which addon code depends on it. */
  usedBy: string;
  kind: SourceKind;
  pattern: RegExp;
}

const lua = (id: string, usedBy: string, pattern: RegExp): ContractCheck => ({
  id,
  usedBy,
  kind: "lua",
  pattern,
});
const xml = (id: string, usedBy: string, pattern: RegExp): ContractCheck => ({
  id,
  usedBy,
  kind: "xml",
  pattern,
});
const docs = (id: string, usedBy: string, pattern: RegExp): ContractCheck => ({
  id,
  usedBy,
  kind: "docs",
  pattern,
});

const apiFunction = (namespace: string, name: string, usedBy: string) =>
  docs(
    `${namespace}.${name}`,
    usedBy,
    new RegExp(`Namespace = "${namespace}"[\\s\\S]*?Name = "${name}"`),
  );

const event = (name: string, usedBy: string) =>
  docs(`event ${name}`, usedBy, new RegExp(`LiteralName = "${name}"`));

/** Legacy globals are not in the generated docs; FrameXML calling them proves they exist. */
const globalCall = (name: string, usedBy: string) =>
  lua(`${name}()`, usedBy, new RegExp(`[^\\w.:]${name}\\(`));

export const CONTRACT: ContractCheck[] = [
  // Quest window titles (UI/QuestFrame.lua)
  lua(
    "QuestInfo_Display",
    "UI/QuestFrame.lua",
    /^function QuestInfo_Display\(template, parentFrame, acceptButton, material, mapView\)/m,
  ),
  lua(
    "QuestInfo_Display is called through the global",
    "UI/QuestFrame.lua",
    /\tQuestInfo_Display\(QUEST_TEMPLATE_DETAIL, QuestDetailScrollChildFrame/,
  ),
  lua(
    "QuestInfo titles use GetSelectedQuest for log templates",
    "UI/QuestFrame.lua",
    /if \( QuestInfoFrame\.questLog \) then\s+return C_QuestLog\.GetSelectedQuest\(\);/,
  ),
  lua(
    "QuestInfo_ShowTitle writes QuestInfoTitleHeader",
    "UI/QuestFrame.lua",
    /QuestInfoTitleHeader:SetText\(title\);/,
  ),
  xml(
    "QuestInfoTitleHeader",
    "UI/QuestFrame.lua",
    /name="QuestInfoTitleHeader"/,
  ),
  xml(
    "QuestFrameProgressPanel OnShow",
    "UI/QuestFrame.lua",
    /<OnShow function="QuestFrameProgressPanel_OnShow"\/>/,
  ),
  lua(
    "progress title text",
    "UI/QuestFrame.lua",
    /QuestProgressTitleText:SetText\(GetTitleText\(\)\);/,
  ),
  xml("QuestFrame", "Core/Notices.lua", /<Frame name="QuestFrame"/),

  // Quest greeting (UI/GossipFrame.lua)
  xml(
    "QuestFrameGreetingPanel OnShow binds the function value",
    "UI/GossipFrame.lua",
    /<OnShow function="QuestFrameGreetingPanel_OnShow"\/>/,
  ),
  lua(
    "greeting refresh calls the global",
    "UI/GossipFrame.lua",
    /QuestFrameGreetingPanel_OnShow\(QuestFrameGreetingPanel\);/,
  ),
  lua(
    "greeting title button pool",
    "UI/GossipFrame.lua",
    /self\.titleButtonPool = CreateFramePool\("BUTTON", self, "QuestTitleButtonTemplate"\);/,
  ),
  lua(
    "greeting buttons carry isActive and the list index",
    "UI/GossipFrame.lua",
    /questTitleButton\.isActive = 1;[\s\S]*questTitleButton:SetID\(i - numActiveQuests\);\s+questTitleButton\.isActive = 0;/,
  ),
  lua(
    "GetAvailableQuestInfo returns questID fifth",
    "UI/GossipFrame.lua",
    /local isTrivial, frequency, isRepeatable, isLegendary, questID[, \w]* = GetAvailableQuestInfo\(/,
  ),
  xml(
    "QuestTitleButtonTemplate has an Icon",
    "UI/GossipFrame.lua",
    /<Button name="QuestTitleButtonTemplate"[\s\S]{0,300}parentKey="Icon"/,
  ),

  // Gossip (UI/GossipFrame.lua)
  lua(
    "gossip button types",
    "UI/GossipFrame.lua",
    /GOSSIP_BUTTON_TYPE_ACTIVE_QUEST = 4;\s+GOSSIP_BUTTON_TYPE_AVAILABLE_QUEST = 5;/,
  ),
  lua(
    "gossip rows carry the quest info",
    "UI/GossipFrame.lua",
    /dataProvider:Insert\(\{buttonType= GOSSIP_BUTTON_TYPE_AVAILABLE_QUEST, info=questInfo/,
  ),
  lua(
    "gossip ScrollBox location",
    "UI/GossipFrame.lua",
    /self\.GreetingPanel\.ScrollBox:SetDataProvider\(/,
  ),
  xml(
    "gossip buttons have an Icon",
    "UI/GossipFrame.lua",
    /<Button name="GossipTitleButtonArtTemplate"[\s\S]{0,300}parentKey="Icon"/,
  ),
  lua(
    "ScrollUtil.AddInitializedFrameCallback",
    "UI/GossipFrame.lua",
    /^function ScrollUtil\.AddInitializedFrameCallback\(scrollBox, callback, owner, iterateExisting\)/m,
  ),
  lua(
    "initialized callbacks receive owner, frame, elementData",
    "UI/GossipFrame.lua",
    /local function OnInitialized\(o, frame, elementData\)/,
  ),
  lua(
    "ForEachFrame passes frame, elementData",
    "UI/GossipFrame.lua",
    /local result = func\(frame, frame:GetElementData\(\)\);/,
  ),
  lua(
    "GossipFrame:Update exists for the fallback",
    "UI/GossipFrame.lua",
    /^function GossipFrameMixin:Update\(\)/m,
  ),

  // Quest log (UI/QuestLog.lua)
  lua(
    "QuestLogQuests_Update",
    "UI/QuestLog.lua",
    /^function QuestLogQuests_Update\(\)/m,
  ),
  lua(
    "quest log title pool",
    "UI/QuestLog.lua",
    /self\.titleFramePool = CreateFramePool\("BUTTON", contentsFrame, "QuestLogTitleTemplate"/,
  ),
  lua(
    "quest log buttons carry questID",
    "UI/QuestLog.lua",
    /button\.questID = questID;/,
  ),
  xml(
    "quest log title Text region",
    "UI/QuestLog.lua",
    /<Button name="QuestLogTitleTemplate"[\s\S]{0,1200}<FontString parentKey="Text"/,
  ),
  lua(
    "quest log title tooltip event",
    "UI/QuestLog.lua",
    /EventRegistry:TriggerEvent\("QuestMapLogTitleButton\.OnEnter", self, questID\);/,
  ),
  lua(
    "quest log POI buttons come from QuestScrollFrame.Contents",
    "UI/QuestLog.lua",
    /QuestScrollFrame\.Contents:GetButtonForQuest\(info\.questID/,
  ),
  lua(
    "quest log POI button sits left of the title",
    "UI/QuestLog.lua",
    /poiButton:SetPoint\("TOPLEFT", button, 6, -4\);/,
  ),
  lua(
    "POIButtonOwnerMixin:FindButtonByQuestID",
    "UI/QuestLog.lua",
    /^function POIButtonOwnerMixin:FindButtonByQuestID\(questID\)/m,
  ),

  // Objective tracker (UI/Tracker.lua)
  lua(
    "QuestObjectiveTracker module mixin",
    "UI/Tracker.lua",
    /QuestObjectiveTrackerMixin = CreateFromMixins\(ObjectiveTrackerModuleMixin/,
  ),
  xml(
    "QuestObjectiveTracker frame",
    "UI/Tracker.lua",
    /name="QuestObjectiveTracker"/,
  ),
  lua(
    "module Update",
    "UI/Tracker.lua",
    /^function ObjectiveTrackerModuleMixin:Update\(availableHeight, dirtyUpdate\)/m,
  ),
  lua(
    "EnumerateActiveBlocks",
    "UI/Tracker.lua",
    /^function ObjectiveTrackerModuleMixin:EnumerateActiveBlocks\(callback\)/m,
  ),
  lua(
    "quest blocks are keyed by quest ID",
    "UI/Tracker.lua",
    /local block, isExistingBlock = self:GetBlock\(questID\);/,
  ),
  xml(
    "tracker blocks have HeaderText",
    "UI/Tracker.lua",
    /<Frame name="ObjectiveTrackerBlockTemplate"[\s\S]{0,300}<FontString parentKey="HeaderText"/,
  ),
  lua(
    "tracker blocks keep their POI button",
    "UI/Tracker.lua",
    /self\.poiButton = button;/,
  ),
  lua(
    "tracker POI button sits left of the header",
    "UI/Tracker.lua",
    /poiButton:SetPoint\("TOPRIGHT", self\.HeaderText, "TOPLEFT", -7, 5\);/,
  ),
  lua(
    "tracker header tooltip event",
    "UI/Tracker.lua",
    /EventRegistry:TriggerEvent\("OnQuestBlockHeader\.OnEnter", block, block\.id, false\);/,
  ),
  lua(
    "map quest pin tooltip event",
    "UI/Tracker.lua",
    /EventRegistry:TriggerEvent\("MapCanvas\.QuestPin\.OnEnter", self, questID\);/,
  ),

  // Item and area trigger offers (Core/Recorder.lua)
  lua(
    "item offers go to an auto quest pop-up and close the offer",
    "Core/Recorder.lua",
    /QuestObjectiveTracker:AddAutoQuestPopUp\(GetQuestID\(\), "OFFER", questStartItemID\)\) then[\s\S]{0,120}CloseQuest\(\);/,
  ),
  lua(
    "AddAutoQuestPopUp signature",
    "Core/Recorder.lua",
    /^function AutoQuestPopupTrackerMixin:AddAutoQuestPopUp\(questID, popUpType, itemID\)/m,
  ),
  lua(
    "QuestObjectiveTracker includes the auto quest pop-up mixin",
    "Core/Recorder.lua",
    /QuestObjectiveTrackerMixin = CreateFromMixins\(ObjectiveTrackerModuleMixin, settings, AutoQuestPopupTrackerMixin\);/,
  ),

  // Tooltips (UI/Tooltip.lua)
  lua(
    "TooltipDataProcessor.AddTooltipPostCall",
    "UI/Tooltip.lua",
    /^function TooltipDataProcessor\.AddTooltipPostCall\(tooltipType, func\)/m,
  ),
  docs(
    "Enum.TooltipDataType.Quest",
    "UI/Tooltip.lua",
    /\{ Name = "Quest", Type = "TooltipDataType", EnumValue = \d+ \}/,
  ),
  lua("GameTooltip:IsOwned", "UI/Tooltip.lua", /GameTooltip:IsOwned\(/),
  docs("IsForbidden", "UI/Tooltip.lua", /Name = "IsForbidden"/),

  // Settings (Options/Options.lua)
  lua(
    "Settings.RegisterVerticalLayoutCategory",
    "Options/Options.lua",
    /local category, layout = Settings\.RegisterVerticalLayoutCategory\(/,
  ),
  lua(
    "Settings.RegisterAddOnSetting",
    "Options/Options.lua",
    /^function Settings\.RegisterAddOnSetting\(categoryTbl, variable, variableKey, variableTbl, variableType, name, defaultValue\)/m,
  ),
  lua(
    "Settings.CreateCheckbox",
    "Options/Options.lua",
    /^function Settings\.CreateCheckbox\(category, setting, tooltip\)/m,
  ),
  lua(
    "setting:SetValueChangedCallback",
    "Options/Options.lua",
    /:SetValueChangedCallback\(/,
  ),
  lua(
    "Settings.RegisterAddOnCategory",
    "Options/Options.lua",
    /^function Settings\.RegisterAddOnCategory\(category\)/m,
  ),
  lua(
    "Settings.OpenToCategory",
    "Options/Options.lua",
    /^function Settings\.OpenToCategory\(categoryID/m,
  ),
  lua(
    "CreateSettingsListSectionHeaderInitializer",
    "Options/Options.lua",
    /^function CreateSettingsListSectionHeaderInitializer\(name/m,
  ),
  lua(
    "CreateSettingsButtonInitializer",
    "Options/Options.lua",
    /^function CreateSettingsButtonInitializer\(name, buttonText, buttonClick, tooltip, addSearchTags/m,
  ),

  // Export window (UI/ExportFrame.lua)
  xml(
    "BasicFrameTemplateWithInset",
    "UI/ExportFrame.lua",
    /name="BasicFrameTemplateWithInset"/,
  ),
  xml(
    "BasicFrameTemplate TitleText",
    "UI/ExportFrame.lua",
    /<FontString parentKey="TitleText"/,
  ),
  xml(
    "UIPanelScrollFrameTemplate",
    "UI/ExportFrame.lua",
    /name="UIPanelScrollFrameTemplate"/,
  ),
  xml("ChatFontNormal", "UI/ExportFrame.lua", /name="ChatFontNormal"/),
  xml(
    "GameFontHighlightSmall",
    "UI/ExportFrame.lua",
    /name="GameFontHighlightSmall"/,
  ),
  xml(
    "GameFontNormalSmall",
    "UI/ExportFrame.lua",
    /name="GameFontNormalSmall"/,
  ),

  // Namespaced API (docs)
  apiFunction("C_QuestLog", "GetSelectedQuest", "UI/QuestFrame.lua"),
  apiFunction("C_QuestLog", "GetTitleForQuestID", "Core/Recorder.lua"),
  apiFunction("C_QuestLog", "GetQuestDifficultyLevel", "Core/Recorder.lua"),
  apiFunction("C_QuestLog", "RequestLoadQuestByID", "Core/Diagnostics.lua"),
  apiFunction("C_QuestLog", "GetNumQuestLogEntries", "Core/Recorder.lua"),
  apiFunction("C_QuestLog", "GetInfo", "Core/Recorder.lua"),
  apiFunction("C_QuestLog", "GetLogIndexForQuestID", "Core/Recorder.lua"),
  docs(
    "QuestInfo.difficultyLevel",
    "Core/Recorder.lua",
    /Name = "QuestInfo",[\s\S]*?Name = "difficultyLevel"/,
  ),
  apiFunction("C_GossipInfo", "GetAvailableQuests", "Core/Recorder.lua"),
  apiFunction("C_GossipInfo", "GetActiveQuests", "Core/Recorder.lua"),
  apiFunction("C_Map", "GetBestMapForUnit", "Core/Recorder.lua"),
  apiFunction("C_Map", "GetPlayerMapPosition", "Core/Recorder.lua"),
  apiFunction("C_AddOns", "GetAddOnMetadata", "Core/Init.lua"),
  apiFunction("C_AddOns", "IsAddOnLoaded", "Core/Integrations.lua"),
  docs(
    "GossipQuestUIInfo.questID",
    "UI/GossipFrame.lua",
    /Name = "GossipQuestUIInfo"[\s\S]*?Name = "questID"/,
  ),
  docs(
    "GossipQuestUIInfo.questLevel",
    "Core/Recorder.lua",
    /Name = "GossipQuestUIInfo"[\s\S]*?Name = "questLevel"/,
  ),
  docs(
    "QuestInfo.isHidden",
    "Core/Recorder.lua",
    /Name = "QuestInfo",[\s\S]*?Name = "isHidden"/,
  ),

  // Events
  ...[
    "QUEST_DETAIL",
    "QUEST_PROGRESS",
    "QUEST_COMPLETE",
    "QUEST_GREETING",
    "GOSSIP_SHOW",
    "QUEST_ACCEPTED",
    "QUEST_TURNED_IN",
    "QUEST_LOG_UPDATE",
    "QUEST_DATA_LOAD_RESULT",
    "ADDON_LOADED",
    "PLAYER_LOGIN",
  ].map((name) => event(name, "Core/Recorder.lua, Core/Bootstrap.lua")),

  // Legacy globals and Lua extensions, proven by FrameXML using them
  ...[
    "GetQuestID",
    "GetTitleText",
    "GetNumActiveQuests",
    "GetNumAvailableQuests",
    "GetActiveTitle",
    "GetAvailableTitle",
    "GetActiveQuestID",
    "GetAvailableQuestInfo",
    "UnitGUID",
    "UnitName",
    "UnitFactionGroup",
    "GetBuildInfo",
    "GetLocale",
    "InCombatLockdown",
    "hooksecurefunc",
    "issecretvalue",
    "strsplit",
    "geterrorhandler",
    "debugstack",
    "time",
  ].map((name) => globalCall(name, "addon")),
  lua("C_Timer.After", "Core/Recorder.lua", /C_Timer\.After\(/),
];
