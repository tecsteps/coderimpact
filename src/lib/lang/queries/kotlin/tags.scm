; Kotlin tags: written for Coderimpact (the tree-sitter-kotlin grammar ships no
; queries). Captures follow the standard tags conventions: @name plus
; @definition.<kind> / @reference.<kind>.

; Definitions

(class_declaration
  "interface"
  name: (identifier) @name) @definition.interface

(class_declaration
  "class"
  name: (identifier) @name) @definition.class

(object_declaration
  name: (identifier) @name) @definition.object

(companion_object
  name: (identifier) @name) @definition.object

(function_declaration
  name: (identifier) @name) @definition.function

(secondary_constructor
  "constructor" @name) @definition.constructor

(type_alias
  type: (identifier) @name) @definition.type

(enum_entry
  (identifier) @name) @definition.constant

; Properties declared in a class body or at the top level (locals are in locals.scm).
(class_body
  (property_declaration
    (variable_declaration
      (identifier) @name)) @definition.property)

(source_file
  (property_declaration
    (variable_declaration
      (identifier) @name)) @definition.property)

; Constructor parameters declared with val/var are properties.
(class_parameter
  ["val" "var"]
  (identifier) @name) @definition.property

; References

; foo(), Foo() (a constructor call looks like a function call)
(call_expression
  . (identifier) @name) @reference.call

; obj.foo(), Type.foo()
(call_expression
  . (navigation_expression
    (identifier) @name .)) @reference.call

; Receivers: obj.foo, Type.foo (locals claim variables first)
(navigation_expression
  . (identifier) @name) @reference.variable

; Property access: obj.name, this.name
(navigation_expression
  (identifier) @name .) @reference.field

; Types in declarations, supertypes, parameters and type arguments.
(user_type
  (identifier) @name) @reference.type
