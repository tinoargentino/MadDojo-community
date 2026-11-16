ardour { ["type"] = "EditorAction", name = "Dojo: restart phrase", license = "MIT" }
function factory() return function()
  local loop = Session:locations():auto_loop_location()
  if not loop then return end
  Session:request_locate(loop:start():samples(), false,
    ARDOUR.LocateTransportDisposition.RollIfAppropriate, ARDOUR.TransportRequestSource.TRS_UI)
end end
