#version 450

layout (location = 0) in vec3 inWorldPos;
layout (location = 1) in vec3 inNormal;
layout (location = 2) in vec2 inUV;

layout (binding = 0) uniform UBO 
{
	mat4 projection;
	mat4 model;
	mat4 view;
	vec3 camPos;
} ubo;

layout (binding = 1) uniform UBOShared {
	vec4 lights[4];
	float roughness;
	float metallic;
} uboParams;

layout (binding = 2) uniform sampler2D albedoMap;
layout (binding = 3) uniform sampler2D normalMap;
layout (binding = 4) uniform sampler2D roughnessMap;
layout (binding = 5) uniform sampler2D metallicMap;
layout (binding = 6) uniform sampler2D aoMap;

layout (location = 0) out vec4 outColor;

const float PI = 3.14159265359;

// We do normal mapping without precomputed tangents and use derivatives to get the cotangent frame to perturb the normals
// from http://www.thetenthplanet.de/archives/1180
vec3 perturbNormals(vec3 norm, vec3 pos, vec2 UV)
{
	vec3 dp1 = dFdx(pos);
	vec3 dp2 = dFdy(pos);
	vec2 duv1 = dFdx(UV);
	vec2 duv2 = dFdy(UV);
	vec3 N = normalize(norm);
	vec3 T = normalize(dp1 * duv2.t - dp2 * duv1.t);
	vec3 B = -normalize(cross(N, T));
	mat3 TBN = mat3(T, B, N);
	return normalize(TBN * (texture(normalMap, inUV).xyz * 2.0 - 1.0));
}

vec3 materialcolor()
{
	return pow(texture(albedoMap, inUV).rgb, vec3(2.2));
}

// Normal Distribution function --------------------------------------
float D_GGX(float dotNH, float roughness)
{
	float alpha = roughness * roughness;
	float alpha2 = alpha * alpha;
	float denom = dotNH * dotNH * (alpha2 - 1.0) + 1.0;
	return (alpha2)/(PI * denom*denom); 
}

// Geometric Shadowing function --------------------------------------
float G_SchlickmithGGX(float dotNL, float dotNV, float roughness)
{
	float r = (roughness + 1.0);
	float k = (r*r) / 8.0;
	float GL = dotNL / (dotNL * (1.0 - k) + k);
	float GV = dotNV / (dotNV * (1.0 - k) + k);
	return GL * GV;
}

// Fresnel function ----------------------------------------------------
vec3 F_Schlick(float cosTheta, vec3 F0)
{
	vec3 F = F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0); 
	return F;    
}

// Specular BRDF composition --------------------------------------------

vec3 BRDF(vec3 L, vec3 V, vec3 N, float metallic, float roughness)
{
	// Precalculate vectors and dot products	
	vec3 H = normalize (V + L);
	float dotNV = clamp(dot(N, V), 0.001, 1.0);
	float dotNL = clamp(dot(N, L), 0.001, 1.0);
	float dotLH = clamp(dot(L, H), 0.001, 1.0);
	float dotNH = clamp(dot(N, H), 0.001, 1.0);

	// Light color fixed
	vec3 lightColor = vec3(1.0);

	vec3 color = vec3(0.0);

	vec3 F0 = mix(vec3(0.04), materialcolor(), metallic); // * material.specular

	if (dotNL > 0.0)
	{
		float rroughness = max(0.05, roughness);
		// D = Normal distribution (Distribution of the microfacets)
		float D = D_GGX(dotNH, roughness); 
		// G = Geometric shadowing term (Microfacets shadowing)
		float G = G_SchlickmithGGX(dotNL, dotNV, roughness);
		// F = Fresnel factor (Reflectance depending on angle of incidence)
		vec3 F = F_Schlick(dotNV, F0);

		vec3 spec = D * F * G / (4.0 * dotNL * dotNV);

		//color += spec * dotNL * lightColor;
		color += spec;
	}

	return color;
}

// ----------------------------------------------------------------------------
void main()
{		  
	vec3 N = perturbNormals(normalize(inNormal), inWorldPos, inUV);
	vec3 V = normalize(ubo.camPos - inWorldPos);

	vec3 albedo = materialcolor();
	float metallic = texture(metallicMap, inUV).r;
	float roughness = texture(roughnessMap, inUV).r;
	float ao = texture(aoMap, inUV).r;

	// Specular contribution
	vec3 Lo = vec3(0.0);
	for (int i = 0; i < uboParams.lights.length(); i++) {
		vec3 L = normalize(uboParams.lights[i].xyz - inWorldPos);

		vec3 H = normalize (V + L);

		vec3 F0 = vec3(0.04); 
		F0 = mix(F0, albedo, metallic);
		vec3 F = F_Schlick(max(dot(H, V), 0.0), F0);
		vec3 kS = F;
		vec3 kD = vec3(1.0) - kS;
		kD *= 1.0 - metallic;	  

		// scale light by NdotL
		float NdotL = max(dot(N, L), 0.0);       

		vec3 brdf = BRDF(L, V, N, metallic, roughness);

		Lo += (kD * albedo / PI + brdf) * 1.0 * NdotL; 

	};

	// Combine with ambient
	vec3 color = materialcolor() * 0.02 * ao;
	color += Lo;

	// Gamma correct
	color = pow(color, vec3(0.4545));

	outColor = vec4(color, 1.0);
}