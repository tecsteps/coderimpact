package slug

import (
	"errors"
	"strings"
	"unicode"

	"github.com/nimbusworks/slugkit/internal/translit"
)

// ErrEmpty is returned when the input has no usable characters.
var ErrEmpty = errors.New("slug: empty input")

// normalize lowercases s, transliterates it and trims separators.
func normalize(s string) (string, error) {
	if s == "" {
		return "", ErrEmpty
	}
	s = translit.ToASCII(strings.ToLower(s))
	var b strings.Builder
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		} else {
			b.WriteByte('-')
		}
	}
	return strings.Trim(b.String(), "-"), nil
}

// Make returns a URL-safe slug for title.
func Make(title string, opts ...Option) (string, error) {
	cfg := defaultConfig()
	for _, o := range opts {
		o(&cfg)
	}
	out, err := normalize(title)
	if err != nil {
		return "", err
	}
	return cfg.truncate(out), nil
}
