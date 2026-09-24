local ADDON_NAME, ns = ...

local L = ns.L

ns.name = ADDON_NAME
ns.Data = { Sets = {} }

--- Classification of a quest ID. Values double as the export's `state` field.
ns.State = {
	CLASSIC = "classic",
	CONFIRMED = "confirmed",
	INFERRED = "inferred",
	CHANGED = "changed",
	SOD = "sod",
	ERA = "era",
	UNKNOWN = "unknown",
}

local CHAT_PREFIX = "|cffe6c067" .. L.ADDON_TITLE .. "|r:"

function ns:Print(...)
	print(CHAT_PREFIX, ...)
end

function ns:Debug(...)
	if self.db and self.db.settings.debug then
		print(CHAT_PREFIX, "|cff9d9d9d[debug]|r", ...)
	end
end

function ns:GetVersion()
	local version = C_AddOns.GetAddOnMetadata(ADDON_NAME, "Version")
	-- The packager replaces the token; a git checkout still carries it.
	if not version or version:find("@", 1, true) then
		return "dev"
	end
	return version
end

-- Error handling ------------------------------------------------------------

local MAX_ERRORS = 25
local sessionErrors = {}
local notifiedThisSession = false

local function CaptureError(message)
	local stack
	if debugstack then
		stack = debugstack(2)
	elseif debug and debug.traceback then
		stack = debug.traceback("", 2)
	end
	return { message = tostring(message), stack = stack or "" }
end

--- Records an error once per unique message, forwards the first occurrence to the
--- game's error handler (so BugSack and the Lua error frame see it) and keeps going.
function ns:ReportError(context, captured)
	local key = context .. "\0" .. captured.message
	local entry = sessionErrors[key]
	if entry then
		entry.count = entry.count + 1
		return
	end

	entry = {
		context = context,
		message = captured.message,
		stack = captured.stack,
		count = 1,
		time = time(),
		version = self:GetVersion(),
	}
	sessionErrors[key] = entry

	local log = self.db and self.db.errors
	if log then
		table.insert(log, 1, entry)
		for i = #log, MAX_ERRORS + 1, -1 do
			log[i] = nil
		end
	end

	if not notifiedThisSession then
		notifiedThisSession = true
		self:Print(L.ERROR_NOTICE:format(context))
	end

	local handler = geterrorhandler and geterrorhandler()
	if handler then
		handler(("%s (%s): %s"):format(ADDON_NAME, context, captured.message))
	end
end

--- Calls fn(...) and contains any error it raises. Every hook and event handler
--- goes through this so a broken integration never breaks Blizzard's UI flow.
function ns.SafeCall(context, fn, ...)
	local count = select("#", ...)
	local args = { ... }
	local ok, result = xpcall(function()
		return fn(unpack(args, 1, count))
	end, CaptureError)
	if not ok then
		ns:ReportError(context, result)
	end
	return ok
end

-- Events --------------------------------------------------------------------

local eventFrame = CreateFrame("Frame")
local eventHandlers = {}

eventFrame:SetScript("OnEvent", function(_, event, ...)
	local handlers = eventHandlers[event]
	if not handlers then
		return
	end
	for i = 1, #handlers do
		ns.SafeCall(event, handlers[i], ...)
	end
end)

--- Registers handler(...) for a game event. Handlers run in registration order.
function ns:RegisterEvent(event, handler)
	local handlers = eventHandlers[event]
	if not handlers then
		handlers = {}
		eventHandlers[event] = handlers
		eventFrame:RegisterEvent(event)
	end
	table.insert(handlers, handler)
end

function ns:UnregisterEvent(event, handler)
	local handlers = eventHandlers[event]
	if not handlers then
		return
	end
	for i = #handlers, 1, -1 do
		if handlers[i] == handler then
			table.remove(handlers, i)
		end
	end
	if #handlers == 0 then
		eventHandlers[event] = nil
		eventFrame:UnregisterEvent(event)
	end
end

-- Internal messages between modules (for example settings changes) --------

local listeners = {}

function ns:On(message, handler)
	listeners[message] = listeners[message] or {}
	table.insert(listeners[message], handler)
end

function ns:Fire(message, ...)
	local handlers = listeners[message]
	if not handlers then
		return
	end
	for i = 1, #handlers do
		ns.SafeCall(message, handlers[i], ...)
	end
end
