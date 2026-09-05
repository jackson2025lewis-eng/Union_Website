const otpBoxes = [
    { value: '', classList: { contains: () => false } },
    { value: '', classList: { contains: () => false } },
    { value: '', classList: { contains: () => false } },
    { value: '', classList: { contains: (cls) => cls === 'numeric' } },
    { value: '', classList: { contains: (cls) => cls === 'numeric' } },
    { value: '', classList: { contains: (cls) => cls === 'numeric' } },
    { value: '', classList: { contains: (cls) => cls === 'numeric' } }
];
let pastedData = 'lsu1234'.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
for (let i = 0; i < otpBoxes.length; i++) {
    if (i < pastedData.length) {
        let char = pastedData[i];
        if (otpBoxes[i].classList.contains('numeric')) {
            char = char.replace(/[^0-9]/g, '');
        } else {
            char = char.replace(/[^A-Z]/g, '');
        }
        otpBoxes[i].value = char;
    } else {
        otpBoxes[i].value = '';
    }
}
console.log(otpBoxes.map(b => b.value).join(''));
