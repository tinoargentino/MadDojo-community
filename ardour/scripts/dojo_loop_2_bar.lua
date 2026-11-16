ardour { ["type"] = "EditorAction", name = "Dojo: loop 2 bars", license = "MIT",
  description = "Loop a phrase using this session's detected beats." }
function factory() return function()
  local chunk = loadfile(Session:path() .. "/dojo-grid.lua")
  if not chunk then print("Open a MadDojo session to use the detected beat grid"); return end
  local grid = chunk()
  local now = Session:transport_sample() / Session:nominal_sample_rate()
  local index = 1
  for i, beat in ipairs(grid.beats) do
    if beat <= now + .02 then index = i else break end
  end
  local phase = (index - 1 + (grid.first_index or 0)) % grid.meter
  index = index - phase
  local a = grid.beats[index] or 0
  local b = grid.beats[index + 2 * grid.meter] or
    math.min(grid.duration, a + 2 * grid.meter * 60 / grid.bpm)
  if b <= a then return end
  local rate = Session:nominal_sample_rate()
  local loop = Session:locations():auto_loop_location()
  if not loop then return end
  loop:set(Temporal.timepos_t(math.floor(a * rate + .5)),
    Temporal.timepos_t(math.floor(b * rate + .5)))
  Session:request_play_loop(true, false)
end end
