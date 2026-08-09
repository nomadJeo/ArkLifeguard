# Runtime Validation

|Case|Build|Trigger|Result|log|
|-|-|-|-|-|
|DirectNull|✓|launch|NPD||
|FieldPropagation|✓|launch|NPD||
|SafeNullCheck|✓|launch|Safe||
|PromiseCallback|✓|launch|Unknown||
|PageReuse|✓|click back|NPD|

Environment:
- DevEco: 5.x
- SDK: API xx
- Device: emulator