-- Generate the structural session with Ardour's own engine, not a guessed schema.
-- flatpak run --command=ardour9-lua org.ardour.Ardour scripts/generate_ardour_template.lua /absolute/new/session/path
assert(arg[1], "Pass a new session directory")
assert(create_session(arg[1], "Vocal Dojo", 44100), "Could not create session")

local function track(name, inputs, gain)
  local tracks = Session:new_audio_track(inputs, 2, ARDOUR.RouteGroup(), 1, name,
    ARDOUR.PresentationInfo.max_order, ARDOUR.TrackMode.Normal, false)
  assert(not tracks:empty(), "Could not create " .. name)
  local t = tracks:front()
  t:gain_control():set_value(gain, PBD.GroupControlDisposition.NoGroup)
  return t
end

track("Backing", 2, 0.85)
track("Guide vocal", 2, 0.35)
track("Your voice", 1, 1.0)
Session:save_state("")
close_session()
print("Vocal Dojo session template generated")
