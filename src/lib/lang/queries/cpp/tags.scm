; Tags for C++: definitions with an @name capture, references by name.
; Free-function prototypes (no body) are not definitions, so a call resolves
; to the function body. Method prototypes inside a class ARE definitions:
; they carry the class membership that an out-of-line definition
; (`double Circle::area() const {...}`) lacks in this adapter, which only
; derives a container from nesting.
; Constructors are not definitions either: a constructor shares its class's
; name, so `geo::Circle` (a `::` member access) or `Circle` next to an
; out-of-line `Circle::Circle` would resolve to the constructor instead of
; the class. In-class constructors use an (identifier) name, methods a
; (field_identifier); out-of-line constructors have scope == name.
; Namespaces are not definitions: as containers they would turn every free
; function in them into a "method".

; Types

(class_specifier name: (type_identifier) @name body: (_)) @definition.class

(struct_specifier name: (type_identifier) @name body: (_)) @definition.struct

(union_specifier name: (type_identifier) @name body: (_)) @definition.union

(enum_specifier name: (type_identifier) @name body: (_)) @definition.enum

(alias_declaration name: (type_identifier) @name) @definition.type

(type_definition
  type: (_ name: (type_identifier) @_tag)
  declarator: (type_identifier) @name
  (#not-eq? @_tag @name)) @definition.type

(type_definition
  type: (_ !name)
  declarator: (type_identifier) @name) @definition.type

(enumerator name: (identifier) @name) @definition.constant

; Methods defined or declared inside a class body
(field_declaration_list (function_definition declarator: (function_declarator declarator: [(field_identifier) (destructor_name) (operator_name)] @name)) @definition.method)
(field_declaration_list (function_definition declarator: (pointer_declarator declarator: (function_declarator declarator: [(field_identifier) (destructor_name) (operator_name)] @name))) @definition.method)
(field_declaration_list (function_definition declarator: (reference_declarator (function_declarator declarator: [(field_identifier) (destructor_name) (operator_name)] @name))) @definition.method)
(field_declaration_list (field_declaration declarator: (function_declarator declarator: [(field_identifier) (destructor_name) (operator_name)] @name)) @definition.method)
(field_declaration_list (field_declaration declarator: (pointer_declarator declarator: (function_declarator declarator: [(field_identifier) (destructor_name) (operator_name)] @name))) @definition.method)
(field_declaration_list (field_declaration declarator: (reference_declarator (function_declarator declarator: [(field_identifier) (destructor_name) (operator_name)] @name))) @definition.method)
(field_declaration_list (declaration declarator: (function_declarator declarator: (destructor_name) @name)) @definition.method)
(field_declaration_list (template_declaration (function_definition declarator: (function_declarator declarator: [(field_identifier) (destructor_name) (operator_name)] @name)) @definition.method))

; Fields

(field_declaration declarator: [(field_identifier) @name (pointer_declarator declarator: (field_identifier) @name) (reference_declarator (field_identifier) @name) (array_declarator declarator: (field_identifier) @name)]) @definition.field

; Free functions (with a body), outside class bodies

(translation_unit (function_definition declarator: (function_declarator declarator: (identifier) @name)) @definition.function)
(translation_unit (function_definition declarator: (pointer_declarator declarator: (function_declarator declarator: (identifier) @name))) @definition.function)
(translation_unit (function_definition declarator: (reference_declarator (function_declarator declarator: (identifier) @name))) @definition.function)
(declaration_list (function_definition declarator: (function_declarator declarator: (identifier) @name)) @definition.function)
(declaration_list (function_definition declarator: (pointer_declarator declarator: (function_declarator declarator: (identifier) @name))) @definition.function)
(declaration_list (function_definition declarator: (reference_declarator (function_declarator declarator: (identifier) @name))) @definition.function)
(template_declaration (function_definition declarator: (function_declarator declarator: (identifier) @name)) @definition.function)
(template_declaration (function_definition declarator: (pointer_declarator declarator: (function_declarator declarator: (identifier) @name))) @definition.function)
(template_declaration (function_definition declarator: (reference_declarator (function_declarator declarator: (identifier) @name))) @definition.function)
(linkage_specification (function_definition declarator: (function_declarator declarator: (identifier) @name)) @definition.function)
(linkage_specification (function_definition declarator: (pointer_declarator declarator: (function_declarator declarator: (identifier) @name))) @definition.function)
(linkage_specification (function_definition declarator: (reference_declarator (function_declarator declarator: (identifier) @name))) @definition.function)
(preproc_ifdef (function_definition declarator: (function_declarator declarator: (identifier) @name)) @definition.function)
(preproc_ifdef (function_definition declarator: (pointer_declarator declarator: (function_declarator declarator: (identifier) @name))) @definition.function)
(preproc_ifdef (function_definition declarator: (reference_declarator (function_declarator declarator: (identifier) @name))) @definition.function)
(preproc_if (function_definition declarator: (function_declarator declarator: (identifier) @name)) @definition.function)
(preproc_if (function_definition declarator: (pointer_declarator declarator: (function_declarator declarator: (identifier) @name))) @definition.function)
(preproc_if (function_definition declarator: (reference_declarator (function_declarator declarator: (identifier) @name))) @definition.function)
(preproc_else (function_definition declarator: (function_declarator declarator: (identifier) @name)) @definition.function)
(preproc_else (function_definition declarator: (pointer_declarator declarator: (function_declarator declarator: (identifier) @name))) @definition.function)
(preproc_else (function_definition declarator: (reference_declarator (function_declarator declarator: (identifier) @name))) @definition.function)

; Out-of-line definitions: `Type::method` (container not derived, see above).
; `Circle::Circle` (scope == name) is a constructor and is skipped.

(function_definition declarator: (function_declarator declarator: (qualified_identifier scope: (_) @_scope name: (identifier) @name (#not-eq? @_scope @name)))) @definition.method
(function_definition declarator: (pointer_declarator declarator: (function_declarator declarator: (qualified_identifier scope: (_) @_scope name: (identifier) @name (#not-eq? @_scope @name))))) @definition.method
(function_definition declarator: (reference_declarator (function_declarator declarator: (qualified_identifier scope: (_) @_scope name: (identifier) @name (#not-eq? @_scope @name))))) @definition.method
(function_definition declarator: (function_declarator declarator: (qualified_identifier name: [(destructor_name) (operator_name)] @name))) @definition.method
(function_definition declarator: (pointer_declarator declarator: (function_declarator declarator: (qualified_identifier name: [(destructor_name) (operator_name)] @name)))) @definition.method
(function_definition declarator: (reference_declarator (function_declarator declarator: (qualified_identifier name: [(destructor_name) (operator_name)] @name)))) @definition.method
(function_definition declarator: (function_declarator declarator: (qualified_identifier name: (qualified_identifier scope: (_) @_scope name: (identifier) @name (#not-eq? @_scope @name))))) @definition.method
(function_definition declarator: (pointer_declarator declarator: (function_declarator declarator: (qualified_identifier name: (qualified_identifier scope: (_) @_scope name: (identifier) @name (#not-eq? @_scope @name)))))) @definition.method
(function_definition declarator: (reference_declarator (function_declarator declarator: (qualified_identifier name: (qualified_identifier scope: (_) @_scope name: (identifier) @name (#not-eq? @_scope @name)))))) @definition.method

; Macros

(preproc_function_def name: (identifier) @name) @definition.macro

(preproc_def name: (identifier) @name) @definition.constant

; File- and namespace-scope variables (also inside #ifdef blocks)

(translation_unit
  (declaration declarator: [
    (identifier) @name
    (init_declarator declarator: (identifier) @name)
    (init_declarator declarator: (pointer_declarator declarator: (identifier) @name))
    (init_declarator declarator: (reference_declarator (identifier) @name))
    (init_declarator declarator: (array_declarator declarator: (identifier) @name))
    (pointer_declarator declarator: (identifier) @name)
    (array_declarator declarator: (identifier) @name)
  ]) @definition.variable)

(declaration_list
  (declaration declarator: [
    (identifier) @name
    (init_declarator declarator: (identifier) @name)
    (init_declarator declarator: (pointer_declarator declarator: (identifier) @name))
    (init_declarator declarator: (reference_declarator (identifier) @name))
    (init_declarator declarator: (array_declarator declarator: (identifier) @name))
    (pointer_declarator declarator: (identifier) @name)
    (array_declarator declarator: (identifier) @name)
  ]) @definition.variable)

(preproc_ifdef
  (declaration declarator: [
    (identifier) @name
    (init_declarator declarator: (identifier) @name)
    (init_declarator declarator: (pointer_declarator declarator: (identifier) @name))
    (init_declarator declarator: (reference_declarator (identifier) @name))
    (init_declarator declarator: (array_declarator declarator: (identifier) @name))
    (pointer_declarator declarator: (identifier) @name)
    (array_declarator declarator: (identifier) @name)
  ]) @definition.variable)

(preproc_if
  (declaration declarator: [
    (identifier) @name
    (init_declarator declarator: (identifier) @name)
    (init_declarator declarator: (pointer_declarator declarator: (identifier) @name))
    (init_declarator declarator: (reference_declarator (identifier) @name))
    (init_declarator declarator: (array_declarator declarator: (identifier) @name))
    (pointer_declarator declarator: (identifier) @name)
    (array_declarator declarator: (identifier) @name)
  ]) @definition.variable)

(preproc_else
  (declaration declarator: [
    (identifier) @name
    (init_declarator declarator: (identifier) @name)
    (init_declarator declarator: (pointer_declarator declarator: (identifier) @name))
    (init_declarator declarator: (reference_declarator (identifier) @name))
    (init_declarator declarator: (array_declarator declarator: (identifier) @name))
    (pointer_declarator declarator: (identifier) @name)
    (array_declarator declarator: (identifier) @name)
  ]) @definition.variable)

; References (call patterns first: the first match of a name wins)

(call_expression function: (identifier) @name) @reference.call

(call_expression function: (field_expression field: (field_identifier) @name)) @reference.call

(call_expression function: (qualified_identifier name: (identifier) @name)) @reference.call

(call_expression function: (template_function name: (identifier) @name)) @reference.call

(call_expression function: (qualified_identifier name: (template_function name: (identifier) @name))) @reference.call

(call_expression function: (field_expression field: (template_method name: (field_identifier) @name))) @reference.call

(field_expression field: (field_identifier) @name) @reference.field

(field_initializer (field_identifier) @name) @reference.field

(qualified_identifier scope: (namespace_identifier) @name) @reference.type

(type_identifier) @name @reference.type

(identifier) @name @reference.variable
