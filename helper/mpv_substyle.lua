-- JDM — alt yazı ayarlarını MPV-də CANLI tətbiq edir.
-- Əsas mənbə: ~/.config/jdm/subtitle-settings.json
-- (style, size, bold, italic, underline, bg, font, fontResolved)
-- Fayl dəyişdikcə 0.5 saniyə ərzində avtomatik yenilənir.
local mp = require "mp"

local function home()
  return os.getenv("HOME") or ""
end

local CONFIG = home() .. "/.config/jdm/subtitle-settings.json"
local LEGACY = home() .. "/.config/mpv/jdm-substyle"

local presets = {
  default = {
    ["sub-font"] = "YouTube Noto, Roboto, Arial, sans-serif",
    ["sub-font-size"] = 38,
    ["sub-color"] = "#FFFFFF",
    ["sub-bold"] = "no",
    ["sub-italic"] = "no",
    ["sub-spacing"] = 0,
    ["sub-outline-size"] = 0,
    ["sub-border-style"] = "background-box",
    ["sub-back-color"] = "#00000000",
    ["sub-shadow-offset"] = 0,
    ["sub-align-x"] = "center",
    ["sub-align-y"] = "bottom",
    ["sub-pos"] = 95,
  },
  cinematic = {
    ["sub-font"] = "Georgia, Times New Roman, serif",
    ["sub-font-size"] = 38,
    ["sub-color"] = "#F6E6C4",
    ["sub-bold"] = "yes",
    ["sub-italic"] = "no",
    ["sub-spacing"] = 0.4,
    ["sub-outline-size"] = 0,
    ["sub-border-style"] = "background-box",
    ["sub-back-color"] = "#00000000",
    ["sub-shadow-offset"] = 0,
    ["sub-align-x"] = "center",
    ["sub-align-y"] = "bottom",
    ["sub-pos"] = 94,
  },
  minimalist = {
    ["sub-font"] = "Inter, Roboto, Arial, sans-serif",
    ["sub-font-size"] = 38,
    ["sub-color"] = "#FFFFFF",
    ["sub-bold"] = "no",
    ["sub-italic"] = "no",
    ["sub-spacing"] = 0.2,
    ["sub-outline-size"] = 0,
    ["sub-border-style"] = "background-box",
    ["sub-back-color"] = "#00000000",
    ["sub-shadow-offset"] = 0,
    ["sub-align-x"] = "center",
    ["sub-align-y"] = "bottom",
    ["sub-pos"] = 94,
  },
  neon = {
    ["sub-font"] = "Inter, system-ui, sans-serif",
    ["sub-font-size"] = 38,
    ["sub-color"] = "#E8FFFF",
    ["sub-bold"] = "yes",
    ["sub-italic"] = "no",
    ["sub-spacing"] = 1.0,
    ["sub-outline-size"] = 0,
    ["sub-border-style"] = "background-box",
    ["sub-back-color"] = "#00000000",
    ["sub-shadow-offset"] = 0,
    ["sub-align-x"] = "center",
    ["sub-align-y"] = "bottom",
    ["sub-pos"] = 94,
  },
}

-- Minimal JSON oxuyucusu (helper-in yazdığı düz obyekt: hər sətirdə bir açar).
local function read_json(path)
  local f = io.open(path, "r")
  if not f then return nil end
  local out, any = {}, false
  for ln in f:lines() do
    local body = ln:match("^%s*(.-)%s*$") or ""
    body = body:gsub(",%s*$", "")
    local k, v = body:match('^"([^"]+)"%s*:%s*(.*)$')
    if k and v then
      any = true
      if v:sub(1, 1) == '"' then
        out[k] = v:sub(2, -2):gsub('\\"', '"'):gsub("\\\\", "\\")
      elseif v == "true" then out[k] = true
      elseif v == "false" then out[k] = false
      else out[k] = tonumber(v) or v end
    end
  end
  f:close()
  if not any then return nil end
  return out
end

local function clamp_int(v, a, b, d)
  v = tonumber(v)
  if not v then return d end
  v = math.floor(v + 0.5)
  if v < a then v = a end
  if v > b then v = b end
  return v
end

local function read_legacy()
  local f = io.open(LEGACY, "r")
  if not f then return nil end
  local raw = f:read("*a") or ""
  f:close()
  local c = {}
  local any = false
  for k, v in raw:gmatch("([%w_%-]+)%s*=%s*([^\r\n]+)") do
    any = true
    c[k:lower()] = v
  end
  if not any then c.style = raw:gsub("%s+", "") end
  return c
end

local function read_conf()
  local j = read_json(CONFIG)
  local old = (not j or next(j) == nil) and read_legacy() or nil
  local c = {
    style = "default", size = 16, bold = false, italic = false, underline = false, bg = 10,
    font = "", fontResolved = ""
  }
  if j then
    c.style = tostring(j.visualStyle or "default")
    c.size = clamp_int(j.size, 2, 200, 16)
    c.bg = clamp_int(j.bg, 0, 100, 10)
    c.bold = (j.bold == true)
    c.italic = (j.italic == true)
    c.underline = (j.underline == true)
    c.font = tostring(j.font or "")
    c.fontResolved = tostring(j.fontResolved or "")
  elseif old then
    c.style = tostring(old.style or "default")
    c.size = clamp_int(old.size, 2, 200, 16)
    c.bg = clamp_int(old.bg, 0, 100, 10)
    c.bold = (tonumber(old.bold) or 0) ~= 0
    c.italic = (tonumber(old.italic) or 0) ~= 0
    c.underline = (tonumber(old.underline) or 0) ~= 0
  end
  return c
end

local last_key = nil
local last_mtime = nil
local ass_window_default = tostring(mp.get_property("sub-ass-scale-with-window") or "no")

local function file_sig(path)
  local f = io.open(path, "r")
  if not f then return nil end
  local s = f:read("*a") or ""
  f:close()
  return s
end

-- ASS məzmununda "Dual" stilini axtarır (fayl adı dəyişdirilibsə belə ikili faylı tanımaq üçün).
local function has_dual_style(path)
  if not path or path == "" then return false end
  local f = io.open(path, "r")
  if not f then return false end
  local ok = false
  for line in f:lines() do
    if line:find("^Style:%s*Dual") or (line:find("^Dialogue:") and line:find(",Dual,")) then
      ok = true
      break
    end
  end
  f:close()
  return ok
end

local function is_dual()
  local tracks = mp.get_property_native("track-list") or {}
  for _, t in ipairs(tracks) do
    if t.type == "sub" then
      local title = tostring(t.title or "")
      local f = tostring(t["external-filename"] or ""):lower()
      if f:find("%.dual.*%.ass$") or f:find("%.ikili.*%.ass$") or
         title:find("İkili") or title:find("Ikili") then
        return true
      end
    end
  end
  return false
end

local function pick_tracks()
  local tracks = mp.get_property_native("track-list") or {}
  local subs = {}
  for _, t in ipairs(tracks) do
    if t.type == "sub" and t.id then subs[#subs + 1] = t end
  end
  table.sort(subs, function(a, b) return (a.id or 0) < (b.id or 0) end)
  if #subs == 0 then return end
  pcall(mp.set_property, "sub-auto", "no")
  pcall(mp.set_property, "sub-visibility", "yes")
  if is_dual() then
    local dt = subs[1]
    for _, t in ipairs(subs) do
      local title = tostring(t.title or "")
      local f = tostring(t["external-filename"] or ""):lower()
      if title:find("İkili") or title:find("Ikili") or title:lower():find("dual") or
         f:find("%.dual") or f:find("%.ikili") or has_dual_style(f) then
        dt = t; break
      end
    end
    pcall(mp.set_property, "sid", dt.id)
    pcall(mp.set_property, "secondary-sid", "no")
    pcall(mp.set_property, "secondary-sub-visibility", "no")
    return
  end
  -- Yalnız BİR subtitr aktiv olsun. İkinci trek avtomatik açılmasın (üst-alt qarışıqlığı).
  pcall(mp.set_property, "sid", subs[1].id)
  pcall(mp.set_property, "secondary-sid", "no")
  pcall(mp.set_property, "secondary-sub-visibility", "no")
end

local function apply(force)
  local c = read_conf()
  local font = c.fontResolved
  if font == "" and c.font ~= "" and c.font:lower() ~= "default" then font = c.font end
  local key = table.concat({ tostring(c.style), tostring(c.size), tostring(c.bold), tostring(c.italic),
    tostring(c.underline), tostring(c.bg), font }, "|")
  if not force and key == last_key then return end
  last_key = key

  local font_size = math.floor(32 * c.size / 16 + 0.5)
  if font_size < 2 then font_size = 2 end
  local dark = math.floor(c.bg * 2.55 + 0.5)       -- MPV: AA=FF tam qara, 00 şəffaf
  if dark < 0 then dark = 0 end
  if dark > 255 then dark = 255 end
  local back = string.format("#%02X000000", dark)
  local ass_back = string.format("&H%02X000000", 255 - dark)   -- ASS: AA=00 tam qara, FF şəffaf

  local p = presets[c.style] or presets.default
  for k, v in pairs(p) do pcall(mp.set_property, k, v) end
  pcall(mp.set_property, "sub-font-size", font_size)
  pcall(mp.set_property, "sub-bold", c.bold and "yes" or "no")
  pcall(mp.set_property, "sub-italic", c.italic and "yes" or "no")
  pcall(mp.set_property, "sub-back-color", back)
  if font ~= "" then pcall(mp.set_property, "sub-font", font) end

  -- ASS faylı öz stili ilə gəlsə də istifadəçi ayarları üstün olsun.
  pcall(mp.set_property, "sub-ass-override", "force")
  pcall(mp.set_property, "secondary-sub-ass-override", "force")
  local ov = {
    "BorderStyle=4", "Outline=1", "Shadow=0", "BackColour=" .. ass_back,
    "Bold=" .. (c.bold and "1" or "0"),
    "Italic=" .. (c.italic and "1" or "0"),
    "Underline=" .. (c.underline and "1" or "0"),
  }
  if font ~= "" then ov[#ov + 1] = "FontName=" .. font:gsub(",", " ") end
  pcall(mp.set_property, "sub-ass-style-overrides", table.concat(ov, ","))

  local dual = is_dual()
  pcall(mp.set_property, "sub-ass-scale-with-window", dual and "yes" or ass_window_default)
end

mp.register_event("file-loaded", function()
  pick_tracks()
  mp.add_timeout(0.25, pick_tracks)
  apply(true)
end)

mp.add_periodic_timer(0.5, function()
  local sig = file_sig(CONFIG)
  if sig ~= nil and sig ~= last_mtime then
    last_mtime = sig
    apply(true)
  end
end)

apply(true)
