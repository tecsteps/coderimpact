; Definitions

; * modules and protocols
(call
  target: (identifier) @ignore
  (arguments (alias) @name)
  (#any-of? @ignore "defmodule" "defprotocol")) @definition.module

; * functions/macros
(call
  target: (identifier) @ignore
  (arguments
    [
      ; zero-arity functions with no parentheses
      (identifier) @name
      ; regular function clause
      (call target: (identifier) @name)
      ; function clause with a guard clause
      (binary_operator
        left: (call target: (identifier) @name)
        operator: "when")
    ])
  (#any-of? @ignore "def" "defp" "defdelegate" "defguard" "defguardp" "defmacro" "defmacrop" "defn" "defnp")) @definition.function

; * module attributes with a value (`@rate 0.2`); documentation and typespec
;   attributes are not symbols.
(unary_operator
  operator: "@"
  operand: (call target: (identifier) @name)
  (#not-any-of? @name "doc" "moduledoc" "typedoc" "spec" "type" "typep" "opaque" "callback" "macrocallback" "impl" "behaviour" "derive" "enforce_keys" "deprecated" "since" "compile" "dialyzer" "external_resource" "on_load" "before_compile" "after_compile" "after_verify" "optional_callbacks" "vsn" "file")) @definition.constant

; References

; * function call, local (`total(cart)`) or remote (`Cart.total(cart)`).
;   Kernel special forms and definition keywords are not calls to follow.
(call
  target: [
   ; local
   (identifier) @name
   ; remote
   (dot
     right: (identifier) @name)
  ]
  (#not-any-of? @name "def" "defp" "defdelegate" "defguard" "defguardp" "defmacro" "defmacrop" "defn" "defnp" "defmodule" "defprotocol" "defimpl" "defstruct" "defexception" "defoverridable" "alias" "case" "cond" "else" "for" "if" "import" "quote" "raise" "receive" "require" "reraise" "super" "throw" "try" "unless" "unquote" "unquote_splicing" "use" "with")) @reference.call

; * pipe into function call without parentheses
(binary_operator
  operator: "|>"
  right: (identifier) @name) @reference.call

; * function capture of a local function: `&line/1`
(unary_operator
  operator: "&"
  operand: (binary_operator
    left: (identifier) @name
    operator: "/")) @reference.call

; * module attribute read: `@rate`
(unary_operator
  operator: "@"
  operand: (identifier) @name) @reference.constant

; * modules
(alias) @name @reference.module
