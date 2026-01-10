/* * P.E.D.A.L. Mock Data Generator (BG Edition)
 * Генерира реалистични български данни за трафик и логове.
 */

const Generator = {
    
    // 1. Бази данни (Масиви)
    regions: [
        'СВ', 'СА', 'С', // София
        'РВ', // Пловдив
        'В', 'ВН', // Варна
        'В', // Бургас (използва А или В, но за простота)
        'ТХ', // Добрич
        'КН', // Кюстендил
        'А',  // Бургас (старо) / Ямбол (Y) е друго, но слагаме общи
        'ВР', 'ВТ', 'ВХ', 'Г', 'Е', 'ЕБ', 'К', 'КР', 'КТ', 'Л', 'М', 'Н', 'ОВ', 'П', 'ПА', 'ПК', 'ПП', 'Р', 'СМ', 'СН', 'СО', 'СС', 'СТ', 'Т', 'У', 'Х', 'Я'
    ],
    
    models: [
        'VW Golf 4', 'VW Golf 5', 'VW Passat', 
        'Opel Astra', 'Opel Corsa', 
        'BMW E46 (3 Series)', 'BMW E60 (5 Series)', 'BMW X5',
        'Audi A4', 'Audi Q7', 
        'Mercedes C-Class', 'Mercedes G-Class (G-Wagen)',
        'Toyota Corolla', 'Dacia Logan', 'Ford Focus'
    ],
    
    violations: [
        'Неправилно паркиране (Тротоар)', 
        'Преминаване на червен сигнал', 
        'Превишена скорост (>30 км/ч над лимита)', 
        'Движение в БУС лента', 
        'Неплатена Зелена/Синя зона',
        'Паркиране на пешеходна пътека',
        'Обратен завой на забранено място',
        'Липса на ГТП'
    ],

    firstNames: ['Иван', 'Георги', 'Димитър', 'Петър', 'Александър', 'Николай', 'Тодор', 'Стоян', 'Христо', 'Йордан'],
    lastNames: ['Иванов', 'Петров', 'Димитров', 'Георгиев', 'Николов', 'Тодоров', 'Стоянов', 'Христов', 'Йорданов'],

    userAgents: [
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', 
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 
        'P.E.D.A.L. Mobile App/2.8 (Android)',
        'P.E.D.A.L. Admin Console v2.6'
    ],
    
    serverPaths: ['/api/v1/докладвай', '/auth/вход', '/upload/снимка', '/admin/табло', '/api/справка/кат'],

    // 2. Генератори
    getRandomItem: function(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    },

    // Генерира валиден БГ номер: СВ 1234 МК
    generatePlate: function() {
        const region = this.getRandomItem(this.regions);
        const numbers = Math.floor(1000 + Math.random() * 9000); // 1000-9999
        // Генериране на 2 случайни букви
        const letters = String.fromCharCode(65 + Math.random() * 26) + 
                        String.fromCharCode(65 + Math.random() * 26);
        return `${region} ${numbers} ${letters}`;
    },

    // Генерира БГ име
    generateName: function() {
        return `${this.getRandomItem(this.firstNames)} ${this.getRandomItem(this.lastNames)}`;
    },

    // Генерира реалистичен сървърен лог
    generateLog: function() {
        const ip = `192.168.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`;
        const date = new Date().toLocaleTimeString('bg-BG');
        const method = this.getRandomItem(['GET', 'POST', 'PUT']);
        const path = this.getRandomItem(this.serverPaths);
        const status = this.getRandomItem([200, 200, 200, 201, 401, 403, 404, 500]);
        const size = Math.floor(Math.random() * 5000) + 200;
        
        return `[${date}] ${ip} - "${method} ${path} HTTP/1.1" ${status} ${size}ms`;
    },

    // Генерира резултат от "Сканиране"
    generateScanResult: function() {
        return {
            id: 'СИГ-' + Math.floor(Math.random() * 1000000),
            plate: this.generatePlate(),
            model: this.getRandomItem(this.models),
            owner: Math.random() > 0.7 ? this.generateName() : '***** *****', // 30% шанс да покаже име
            violation: this.getRandomItem(this.violations),
            confidence: (Math.random() * (0.99 - 0.70) + 0.70).toFixed(2), // 70-99% увереност
            location: Math.random() > 0.5 ? 'София, Център' : 'Пловдив, Тракия'
        };
    }
};