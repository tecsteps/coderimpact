package translit

// ToASCII replaces non-ASCII letters with ASCII approximations.
func ToASCII(s string) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		if a, ok := table[r]; ok {
			out = append(out, a...)
			continue
		}
		out = append(out, r)
	}
	return string(out)
}
