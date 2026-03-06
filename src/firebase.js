// firebase.js

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { 
    getFirestore, 
    doc, 
    getDoc, 
    setDoc, 
    arrayUnion,
    increment, // Correctly imported from 'firebase/firestore'
    serverTimestamp,
    // Note: We don't need to import FieldValue if we use the named export 'increment'
} from 'firebase/firestore'; 

// Your Firebase configuration
const firebaseConfig = {
    apiKey: "your_key",
    authDomain: "ragg-5a237.firebaseapp.com",
    projectId: "ragg-5a237",
    storageBucket: "ragg-5a237.firebasestorage.app",
    messagingSenderId: "707252934551",
    appId: "1:707252934551:web:5932614da101e38fa916d2"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Export necessary service instances
export const auth = getAuth(app);
export const firestore = getFirestore(app); 
export default app; 

// --- Digital Twin Functions ---

/**
 * 💡 1. Function to Log Time Spent on a Specific Note
 * Tracks time spent per note automatically.
 * Uses increment() for atomic updates, guaranteeing persistence.
 */
export async function logTimeOnNote(studentId, noteId, minutesToAdd) {
    if (!studentId || !noteId || minutesToAdd <= 0) return;

    const progressRef = doc(firestore, "studentProgress", studentId); 
    
    // Dynamically construct the path for the specific note's time counter
    const fieldPath = `noteTimes.${noteId}`;

    try {
        // Use setDoc with merge: true for safe creation/update of time tracking data.
        await setDoc(progressRef, {
            [fieldPath]: increment(minutesToAdd), // **CRITICAL: Uses increment for persistence**
            lastActivity: serverTimestamp()      
        }, { merge: true }); 

        // console.log(`Student ${studentId} logged ${minutesToAdd} min on Note: ${noteId}`);
    } catch (error) {
        console.error("Error logging time on note:", error);
    }
}


/**
 * 💡 2. Function to Update Student Progress (Mark Complete)
 * Marks a specific note ID as complete for a student.
 */
export async function markNoteComplete(studentId, noteId) {
    const progressRef = doc(firestore, "studentProgress", studentId); 

    try {
        // Use setDoc with merge: true to ensure the studentProgress document exists 
        // before attempting arrayUnion.
        await setDoc(progressRef, {
            completedNotes: arrayUnion(noteId) // Safely add the note ID to the array
        }, { merge: true }); 

        console.log(`Note ${noteId} marked complete for student ${studentId}`);
    } catch (error) {
        console.error("Error updating progress:", error);
    }
}


/**
 * 💡 3. Function to Fetch Student Progress
 * Fetches the list of completed notes and time tracking data for a given student ID.
 */
export async function getStudentProgress(studentId) {
    const docRef = doc(firestore, "studentProgress", studentId); 
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        return docSnap.data();
    } else {
        console.log("No progress data found for student:", studentId);
        // Return an object with empty defaults for safety
        return { completedNotes: [], noteTimes: {} }; 
    }
}