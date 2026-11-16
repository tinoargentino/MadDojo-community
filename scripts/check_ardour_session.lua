assert(arg[1], "Pass a session directory")
assert(load_session(arg[1], ""), "Ardour could not load the prepared session")
local expected = { ["Backing"] = true, ["Guide vocal"] = true, ["Your voice"] = true }
local count = 0
for route in Session:get_tracks():iter() do
  local track = route:to_track()
  print("TRACK", track:name(), "GAIN", track:gain_control():get_value())
  assert(expected[track:name()], "Unexpected track")
  expected[track:name()] = nil
  local playlist = track:playlist()
  local regions = playlist:region_list()
  print("REGIONS", regions:size())
  if track:name() ~= "Your voice" then
    assert(regions:size() == 1, "Missing prepared audio region")
    for region in regions:iter() do
      print("REGION", region:name(), region:position():samples(), region:length():samples())
      assert(region:length():samples() > 0)
    end
  else
    assert(regions:empty(), "Voice track should start empty")
  end
  count = count + 1
end
assert(count == 3, "Expected three practice tracks")
local loop = Session:locations():auto_loop_location()
assert(loop, "Missing loop range")
print("LOOP", loop:start():samples(), loop:_end():samples())
print("SESSION END", Session:current_end_sample())
local grid = dofile(Session:path() .. "/dojo-grid.lua")
assert(math.abs(Temporal.TempoMap.read():quarters_per_minute_at(Temporal.timepos_t(0)) - grid.bpm) < .001)
print("NATIVE TEMPO", grid.bpm)
Session:save_state("")
close_session()
print("Ardour session round-trip passed")
