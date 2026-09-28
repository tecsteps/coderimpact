package main

import (
	"fmt"
	"os"

	sk "github.com/nimbusworks/slugkit/slug"
)

func main() {
	out, err := sk.Make(os.Args[1], sk.WithMaxLen(40))
	if err == sk.ErrEmpty {
		os.Exit(2)
	}
	fmt.Println(out)
}
