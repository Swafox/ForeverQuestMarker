local _, ns = ...

local L = ns.L
local Export = ns.Export

-- A movable window with a read-only, pre-selected text box holding the export.

local FRAME_NAME = "ForeverQuestMarkerExportFrame"
local frame

local function CreateExportFrame()
	local window = CreateFrame("Frame", FRAME_NAME, UIParent, "BasicFrameTemplateWithInset")
	window:SetSize(640, 460)
	window:SetPoint("CENTER")
	window:SetFrameStrata("DIALOG")
	window:SetClampedToScreen(true)
	window:SetMovable(true)
	window:EnableMouse(true)
	window:RegisterForDrag("LeftButton")
	-- Wrapped: OnDragStart passes the mouse button, which StartMoving would read as a flag.
	window:SetScript("OnDragStart", function(self)
		self:StartMoving()
	end)
	window:SetScript("OnDragStop", function(self)
		self:StopMovingOrSizing()
	end)
	window.TitleText:SetText(L.EXPORT_TITLE)
	-- Escape closes the window through the focused text box. Adding the frame to
	-- UISpecialFrames would put a tainted entry in a table secure code iterates.

	local hint = window:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
	hint:SetPoint("TOPLEFT", 16, -34)
	hint:SetPoint("RIGHT", -16, 0)
	hint:SetJustifyH("LEFT")
	hint:SetText(Export.SUBMIT_URL and L.EXPORT_HINT_URL:format(Export.SUBMIT_URL) or L.EXPORT_HINT)
	window.Hint = hint

	local summary = window:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
	summary:SetPoint("TOPLEFT", hint, "BOTTOMLEFT", 0, -4)
	window.Summary = summary

	local scroll = CreateFrame("ScrollFrame", nil, window, "UIPanelScrollFrameTemplate")
	scroll:SetPoint("TOPLEFT", 16, -70)
	scroll:SetPoint("BOTTOMRIGHT", -34, 14)

	local editBox = CreateFrame("EditBox", nil, scroll)
	editBox:SetMultiLine(true)
	editBox:SetAutoFocus(false)
	editBox:SetMaxLetters(0)
	editBox:SetFontObject(ChatFontNormal)
	editBox:SetWidth(580)
	editBox:SetScript("OnEscapePressed", function()
		window:Hide()
	end)
	-- Read only: undo any typing and keep everything selected for copying.
	editBox:SetScript("OnTextChanged", function(self, userInput)
		if userInput then
			self:SetText(window.exportText or "")
			self:HighlightText()
		end
	end)
	scroll:SetScrollChild(editBox)
	scroll:SetScript("OnSizeChanged", function(_, width)
		editBox:SetWidth(width)
	end)
	window.EditBox = editBox

	return window
end

--- Opens the export window. `kind` is "json" (default) or "csv".
function ns.ShowExport(kind)
	local document = Export.BuildDocument()
	if document.count == 0 then
		ns:Print(L.EXPORT_EMPTY)
		return nil
	end
	kind = type(kind) == "string" and kind:lower() == "csv" and "csv" or "json"
	local text = kind == "csv" and Export.ToCSV(document) or Export.ToJSON(document)

	frame = frame or CreateExportFrame()
	frame.exportText = text
	frame.EditBox:SetText(text)
	frame.Summary:SetText(L.EXPORT_SUMMARY:format(document.count, kind:upper()))
	frame:Show()
	frame.EditBox:SetFocus()
	frame.EditBox:HighlightText()
	return frame
end
