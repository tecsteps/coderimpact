def format(value)
  value.to_s.strip
end

def banner(title)
  line = "=" * title.length
  [line, format(title), line].join("\n")
end
