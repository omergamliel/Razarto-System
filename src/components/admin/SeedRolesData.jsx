// import { useEffect } from 'react';
// import { base44 } from '@/api/base44Client';

// const INITIAL_ROLES = [
//   // Department 'ש'
//   { department: 'א', role_name: 'אינטגרציה מבצעית', assigned_user_name: 'ספיר לוי' },
//   { department: 'א', role_name: 'ביטחון', assigned_user_name: 'אלעד פסל' },
//   { department: 'א', role_name: 'דיגיטל', assigned_user_name: 'חן שבתאי' },
//   { department: 'א', role_name: 'צבאי מערכתי', assigned_user_name: 'צבאי מערכתי' },
//   // Department 'מ'
//   { department: 'מ', role_name: 'דרום', assigned_user_name: 'איתי תורג\'מן' },
//   { department: 'מ', role_name: 'מרכז', assigned_user_name: 'שמעון עורקבי' },
//   { department: 'מ', role_name: 'צפון', assigned_user_name: 'רוני בורשטיין' },
//   { department: 'מ', role_name: 'עורף', assigned_user_name: 'שיראל כהן' },
//   { department: 'מ', role_name: 'שליטה', assigned_user_name: 'ספיר הרשקו' },
//   { department: 'מ', role_name: 'מבצעים', assigned_user_name: 'דורון מיכאלי' },
//   { department: 'מ', role_name: 'סייבר', assigned_user_name: 'עינבל זיגר' },
//   { department: 'מ', role_name: 'תה"ם', assigned_user_name: 'מאיה סולטן' },
//   // Department 'ת'
//   { department: 'ת', role_name: 'תקיפה', assigned_user_name: 'ניב מלין' },
//   { department: 'ת', role_name: 'ח"ח', assigned_user_name: 'חיים פרנסיו' },
//   { department: 'ת', role_name: 'רציפות התפקוד', assigned_user_name: 'דין ויינשטיין' },
//   { department: 'ת', role_name: 'עומק', assigned_user_name: 'יאיר אלשיך' },
//   { department: 'ת', role_name: 'מעג"ש', assigned_user_name: 'יעל ליבנה' },
//   { department: 'ת', role_name: 'תב"ל', assigned_user_name: 'עודד בן צור' },
//   { department: 'ת', role_name: 'תכנון', assigned_user_name: 'יהב ברזילי' }
// ];

// export default function SeedRolesData() {
//   useEffect(() => {
//     const seedRoles = async () => {
//       try {
//         const existingRoles = await base44.entities.RoleDefinition.list();
        
//         // Only seed if DB is empty
//         if (existingRoles.length === 0) {
//           await base44.entities.RoleDefinition.bulkCreate(INITIAL_ROLES);
//           console.log('✅ RoleDefinition seeded with 20 roles');
//         }
//       } catch (error) {
//         console.error('Failed to seed roles:', error);
//       }
//     };

//     seedRoles();
//   }, []);

//   return null; // This is a utility component, renders nothing
// }