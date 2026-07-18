function setCustomPropertyValue(propertyName, value) {
    document
    .querySelectorAll(`[name="properties[${propertyName}]"], [data-option-input="${propertyName}"]`)
    .forEach(input => {
        input.value = value || "";
    });
}

// Metal Type
document.querySelectorAll(".metal-image").forEach(item => {

    item.addEventListener("click", function(){

        document.querySelectorAll(".metal-image")
        .forEach(i => i.classList.remove("active"));

        this.classList.add("active");

        setCustomPropertyValue("Metal Type", this.dataset.value);

    });

});


// Diamond Type
document.querySelectorAll(".diamond-box").forEach(item => {

    item.addEventListener("click", function(){

        document.querySelectorAll(".diamond-box")
        .forEach(i => i.classList.remove("active"));

        this.classList.add("active");

        setCustomPropertyValue("Diamond Type", this.dataset.value);

    });

});


// Diamond Clarity
document.querySelectorAll(".clarity-box").forEach(item => {

    item.addEventListener("click", function(){

        document.querySelectorAll(".clarity-box")
        .forEach(i => i.classList.remove("active"));

        this.classList.add("active");

        setCustomPropertyValue("Diamond Clarity", this.dataset.value);

    });

});
