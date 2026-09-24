local _, ns = ...

-- Read-only quest ID sets produced by tools/data/bitset.ts. A set is a list of
-- segments { offset, bits } plus loose IDs. Each character of `bits` holds six IDs
-- in the base64 alphabet, least significant bit first, so a lookup is one string
-- byte read and some arithmetic, with nothing decoded at load time.

local floor = math.floor
local byte = string.byte

local ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local BITS_PER_CHAR = 6
local POW2 = { 1, 2, 4, 8, 16, 32 }

local DECODE = {}
for i = 1, #ALPHABET do
	DECODE[byte(ALPHABET, i)] = i - 1
end

local Bitset = {}
ns.Bitset = Bitset

local SetMixin = {}
local SetMeta = { __index = SetMixin }

--- Builds a set from a generated spec ({ count, segments, ids }).
function Bitset.New(spec)
	local loose = {}
	for _, id in ipairs(spec.ids or {}) do
		loose[id] = true
	end
	return setmetatable({
		count = spec.count or 0,
		segments = spec.segments or {},
		loose = loose,
	}, SetMeta)
end

function SetMixin:Contains(id)
	if self.loose[id] then
		return true
	end
	local segments = self.segments
	for i = 1, #segments do
		local segment = segments[i]
		local index = id - segment[1]
		if index >= 0 then
			local bits = segment[2]
			local charIndex = floor(index / BITS_PER_CHAR) + 1
			if charIndex <= #bits then
				local value = DECODE[byte(bits, charIndex)]
				if value and floor(value / POW2[index % BITS_PER_CHAR + 1]) % 2 == 1 then
					return true
				end
			end
		end
	end
	return false
end

function SetMixin:GetCount()
	return self.count
end
