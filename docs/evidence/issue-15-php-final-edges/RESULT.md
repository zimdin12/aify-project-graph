# PHP final edges on a real Laravel application (#15, #4)

Specimen: BookStack (https://github.com/BookStackApp/BookStack) at 0b6b667e0d84ebb3406de6de9fadbf4230c29c0b, a shallow
clone in a scratch directory; 1846 PHP files on disk, 1843 indexed. The same commit #4's evidence used.

Reproduce: `node docs/evidence/issue-15-php-final-edges/probe.mjs <apg-checkout> <BookStack-clone> <label>`. Each run
deletes the clone's `.aify-graph` first, so every figure is a full rebuild. "CALLS from php" is the control: neither fix
touches calls.

```
== BEFORE (both defects) apg 42c8d63f on C:\Users\Administrator\AppData\Local\Temp\apg-specimens\BookStack
php files indexed: 1843; CALLS from php (control): 21988
EXTENDS by target type:    Class=346 External=111
IMPLEMENTS by target type: Class=84
REFERENCES by target type: Class=3101 External=2668 Method=2513 Module=10 Function=8 Test=7
USES_TYPE by target type:  Class=784 External=129
REFERENCES landing on a Method/Function: 2521 edges, 104 names
  top: id=1004 users=429 editor=169 path=136 chapters=59 admin=45 viewer=41 parent=39 config=39 count=35 negated=29 entity=28

== AFTER fix 1 (variables and property reads) apg 42c8d63f + uncommitted changes on C:\Users\Administrator\AppData\Local\Temp\apg-specimens\BookStack
php files indexed: 1843; CALLS from php (control): 21988
EXTENDS by target type:    Class=346 External=111
IMPLEMENTS by target type: Class=84
REFERENCES by target type: Class=3101 External=2663 Module=10
USES_TYPE by target type:  Class=784 External=129
REFERENCES landing on a Method/Function: 0 edges, 0 names
  top: 

== AFTER fix 2 (qualified class names) apg eb02fb6a + uncommitted changes on C:\Users\Administrator\AppData\Local\Temp\apg-specimens\BookStack
php files indexed: 1843; CALLS from php (control): 21988
EXTENDS by target type:    Class=346 External=111
IMPLEMENTS by target type: Class=84
REFERENCES by target type: Class=3111 External=2663
USES_TYPE by target type:  Class=784 External=129
REFERENCES landing on a Method/Function: 0 edges, 0 names
  top: 
```

Reading the three runs:
- Fix 1 (variables and property reads, refs #15): REFERENCES landing on a Method/Function 2521 -> 0.
- Fix 2 (a qualified class name binds to the class its file declares, refs #4): REFERENCES landing on a Module 10 -> 0,
  REFERENCES to a Class 3101 -> 3111. EXTENDS and IMPLEMENTS did not change on BookStack (no aliased project-class
  `extends`); the fixture in tests/fixtures/ingest/matrix-php has one and is asserted.
- CALLS from PHP: 21988 in every run (control).
