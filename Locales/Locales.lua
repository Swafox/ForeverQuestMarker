local _, ns = ...

-- A missing key falls back to the key itself, so an untranslated string stays visible
-- instead of raising an error inside a hook.
ns.L = setmetatable({}, {
	__index = function(_, key)
		return key
	end,
})
