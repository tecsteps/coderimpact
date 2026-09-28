; Definitions

(module (expression_statement (assignment left: (identifier) @name) @definition.constant))

(class_definition
  name: (identifier) @name) @definition.class

(function_definition
  name: (identifier) @name) @definition.function

; Class attributes (`name = ...` or `name: type = ...` in a class body) are members.
(class_definition
  body: (block
    (expression_statement
      (assignment left: (identifier) @name) @definition.field)))

; References

(call
  function: [
      (identifier) @name
      (attribute
        attribute: (identifier) @name)
  ]) @reference.call

; Base classes
(class_definition
  superclasses: (argument_list
    [
      (identifier) @name
      (attribute attribute: (identifier) @name)
    ] @reference.class))

; Imported names: `from pkg.mod import Name` links to Name's declaration.
(import_from_statement
  name: [
    (dotted_name (identifier) @name .)
    (aliased_import name: (dotted_name (identifier) @name .))
  ] @reference.import)

; Module constants used by name (UPPER_CASE by convention).
((identifier) @name @reference.constant
  (#match? @name "^[A-Z][A-Z0-9_]+$"))
