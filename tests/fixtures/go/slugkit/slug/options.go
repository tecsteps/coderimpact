package slug

// Option configures Make.
type Option func(*config)

type config struct {
	MaxLen int
	limits limits
}

type limits struct{ hard int }

func (l limits) Hard() int { return l.hard }

func defaultConfig() config { return config{MaxLen: 64} }

// WithMaxLen limits the slug length.
func WithMaxLen(n int) Option {
	return func(c *config) { c.MaxLen = n }
}

func (c *config) truncate(s string) string {
	if c.MaxLen > 0 && len(s) > c.MaxLen {
		return s[:c.MaxLen]
	}
	_ = c.limits.Hard()
	return s
}
