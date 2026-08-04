import mongoose from 'mongoose';

// This foundation test suite never connects to a real database (see
// DECISIONS.md). Disabling command buffering means any test that
// accidentally exercises a DB-touching route fails fast with a clear
// "not connected" error instead of hanging until a timeout.
mongoose.set('bufferCommands', false);
