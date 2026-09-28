package slug

import "testing"

func TestNormalize(t *testing.T) {
	cases := []struct{ in, want string }{{"Hello World", "hello-world"}}
	for _, tc := range cases {
		got, err := normalize(tc.in)
		if err != nil || got != tc.want {
			t.Fatalf("normalize(%q) = %q, %v", tc.in, got, err)
		}
	}
	normalize := func(s string) string { return s } // shadows the package function
	_ = normalize("x")
}
