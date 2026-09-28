; Tags for Rust: definitions with an @name capture, references by name.

; ADT definitions

(struct_item name: (type_identifier) @name) @definition.struct

(enum_item name: (type_identifier) @name) @definition.enum

(union_item name: (type_identifier) @name) @definition.union

(type_item name: (type_identifier) @name) @definition.type

; Fields and variants (members of their struct or enum)

(field_declaration name: (field_identifier) @name) @definition.field

(enum_variant name: (identifier) @name) @definition.constant

; Implementations: the container of their methods, named after the type
; (`impl Money`, `impl<T> Stack<T>`, `impl Display for Money`).

(impl_item type: (type_identifier) @name) @definition.impl

(impl_item type: (generic_type type: (type_identifier) @name)) @definition.impl

(impl_item type: (scoped_type_identifier name: (type_identifier) @name)) @definition.impl

; Traits and their methods (required and provided)

(trait_item name: (type_identifier) @name) @definition.trait

(function_signature_item name: (identifier) @name) @definition.method

; Functions: methods inside impl/trait bodies, free functions elsewhere

(declaration_list
  (function_item name: (identifier) @name) @definition.method)

(function_item name: (identifier) @name) @definition.function

; Inline modules (`mod name;` without a body is only a file reference)

(mod_item name: (identifier) @name body: (_)) @definition.module

; Constants, statics, macros

(const_item name: (identifier) @name) @definition.constant

(static_item name: (identifier) @name) @definition.constant

(macro_definition name: (identifier) @name) @definition.macro

; References (call patterns first: the first match of a name wins)

(call_expression function: (identifier) @name) @reference.call

(call_expression function: (field_expression field: (field_identifier) @name)) @reference.call

(call_expression function: (scoped_identifier name: (identifier) @name)) @reference.call

(call_expression function: (generic_function function: (identifier) @name)) @reference.call

(call_expression function: (generic_function function: (scoped_identifier name: (identifier) @name))) @reference.call

(call_expression function: (generic_function function: (field_expression field: (field_identifier) @name))) @reference.call

(macro_invocation macro: (identifier) @name) @reference.call

(field_expression field: (field_identifier) @name) @reference.field

(impl_item trait: (type_identifier) @name) @reference.implementation

((scoped_identifier name: (identifier) @name) @reference.name
  (#match? @name "^[A-Z]"))

(type_identifier) @name @reference.type

; Other identifiers: capitalized ones (types in paths such as `Money::new`,
; consts, statics) and plain function arguments. Lowercase path segments are
; modules and crates (`std::fmt`), which are not declarations here, so they
; are left out rather than matched to an unrelated function of that name.

((identifier) @name @reference.name
  (#match? @name "^[A-Z]"))

(arguments (identifier) @name) @reference.name

; Inside macro calls (`format!("{}", self.total())`) the arguments are only
; tokens: identifiers there are references, but not recognizable calls.

(token_tree (identifier) @name) @reference.name
