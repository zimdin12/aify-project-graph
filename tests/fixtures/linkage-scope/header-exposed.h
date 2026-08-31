// Class 4: the ORDINARY case. Declared in a header, so any TU including it may call it.
// A file-local reading is obviously wrong here, and the resolver should win outright.
#pragma once
int headerExposedHelper(int x);
